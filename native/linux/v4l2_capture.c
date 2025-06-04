#define _GNU_SOURCE

#include <linux/videodev2.h>
#include <linux/uvcvideo.h>
#include <linux/usb/video.h>

#include <sys/types.h>
#include <sys/stat.h>
#include <sys/ioctl.h>
#include <sys/mman.h>
#include <sys/socket.h>
#include <sys/un.h>
#include <fcntl.h>
#include <stdbool.h>
#include <stdio.h>
#include <stdarg.h>
#include <string.h>
#include <errno.h>
#include <stdlib.h>
#include <unistd.h>
#include <getopt.h>
#include <signal.h>
#include <assert.h>
#include <poll.h>

#include "capture_interface.h"

#define FMT_4CC "%c%c%c%c"
#define ARG_4CC(v)                                                             \
	((v) & 0xff), ((v) >> 8) & 0xff, ((v) >> 16) & 0xff, ((v) >> 24) & 0xff

#define ARRAY_SIZE(x) (sizeof(x) / sizeof((x)[0]))

#define message(fmt, args...) fprintf(stdout, fmt, ##args)
#define message1(fmt, args...) message("  " fmt, ##args)
#define message2(fmt, args...) message1("  " fmt, ##args)
#define message3(fmt, args...) message2("  " fmt, ##args)

#define error(fmt, args...)                                                    \
	fprintf(stderr, "%s.%d: " fmt, __func__, __LINE__, ##args)

#define v4l2_ioctl(args...) ioctl(cam.dev_fd, ##args)

enum filetype {
	FILE_TYPE_ALL_FRAME = 0,
	FILE_TYPE_SEPERATE_FRAME,
	FILE_TYPE_LAST_FRAME,
	FILE_TYPE_TEMP,
	FILE_TYPE_PID,
	FILE_TYPE_CONFIG,
	FILE_TYPE_SOCKET,
	NUM_FILE_TYPE,
};

struct arguments {
	const char *dev_name;
	__u32 pixelformat;
	__u32 width;
	__u32 height;
	double fps;

	__u32 num_files_to_save;
	int debug_level;
	int dump_level;
	bool drop_broken;

	const char *filename[NUM_FILE_TYPE];

	__u32 skip_frame_count;
};

#define MAX_BUFFER 4

struct buffer {
	struct v4l2_buffer vb;
	void *mem;
};

struct camera {
	int dev_fd;
	int sock_fd;
	bool use_sock;
	bool running;
	struct v4l2_capability caps;
	__u32 capabilities;

	__u32 pixelformat;
	__u32 width;
	__u32 height;

	struct v4l2_fract timeperframe;
	double fps;

	struct v4l2_fract disp_timeperframe;
	__u32 skipped_frames;

	int all_frame_fd;
	__u32 seperate_frame_num;

	struct buffer buf[MAX_BUFFER];
	__u32 num_buf;

	__u32 frame_count;
	__u32 disp_count;
};

static struct camera cam;
static struct arguments args;

static const char *buf_type_str(enum v4l2_buf_type type)
{
	switch (type) {
	case V4L2_BUF_TYPE_VIDEO_CAPTURE:
		return "Video Capture";
	case V4L2_BUF_TYPE_VIDEO_CAPTURE_MPLANE:
		return "Video Capture Multiplanar";
	case V4L2_BUF_TYPE_VIDEO_OUTPUT:
		return "Video Output";
	case V4L2_BUF_TYPE_VIDEO_OUTPUT_MPLANE:
		return "Video Output Multiplanar";
	case V4L2_BUF_TYPE_VIDEO_OVERLAY:
		return "Video Overlay";
	case V4L2_BUF_TYPE_VBI_CAPTURE:
		return "VBI Capture";
	case V4L2_BUF_TYPE_VBI_OUTPUT:
		return "VBI Output";
	case V4L2_BUF_TYPE_SLICED_VBI_CAPTURE:
		return "Sliced VBI Capture";
	case V4L2_BUF_TYPE_SLICED_VBI_OUTPUT:
		return "Sliced VBI Output";
	case V4L2_BUF_TYPE_VIDEO_OUTPUT_OVERLAY:
		return "Video Output Overlay";
	case V4L2_BUF_TYPE_SDR_CAPTURE:
		return "SDR Capture";
	case V4L2_BUF_TYPE_SDR_OUTPUT:
		return "SDR Output";
	case V4L2_BUF_TYPE_META_CAPTURE:
		return "Metadata Capture";
	case V4L2_BUF_TYPE_META_OUTPUT:
		return "Metadata Output";
	case V4L2_BUF_TYPE_PRIVATE:
		return "Private";
	default:
		return "Unknown";
	}
}

static const char *colorspace_str(enum v4l2_colorspace val)
{
	switch (val) {
	case V4L2_COLORSPACE_DEFAULT:
		return "Default";
	case V4L2_COLORSPACE_SMPTE170M:
		return "SMPTE 170M";
	case V4L2_COLORSPACE_SMPTE240M:
		return "SMPTE 240M";
	case V4L2_COLORSPACE_REC709:
		return "Rec. 709";
	case V4L2_COLORSPACE_BT878:
		return "Broken Bt878";
	case V4L2_COLORSPACE_470_SYSTEM_M:
		return "470 System M";
	case V4L2_COLORSPACE_470_SYSTEM_BG:
		return "470 System BG";
	case V4L2_COLORSPACE_JPEG:
		return "JPEG";
	case V4L2_COLORSPACE_SRGB:
		return "sRGB";
	case V4L2_COLORSPACE_OPRGB:
		return "opRGB";
	case V4L2_COLORSPACE_DCI_P3:
		return "DCI-P3";
	case V4L2_COLORSPACE_BT2020:
		return "BT.2020";
	case V4L2_COLORSPACE_RAW:
		return "Raw";
	default:
		return "Unknown";
	}
}

static int mk_file_dir(const char *fname)
{
	char *dir_path = strdup(fname);
	char *last_slash = strrchr(dir_path, '/');

	if (last_slash) {
		*last_slash = 0;
		struct stat st;
		if (stat(dir_path, &st) != 0) {
			int ret;
			char *cmd;
			ret = asprintf(&cmd, "mkdir -p %s", dir_path);
			assert(ret >= 0);
			ret = system(cmd);
			free(cmd);
			if (ret != 0) {
				error("Can't create directory '%s'\n", dir_path);
				goto err;
			}
		} else if (!S_ISDIR(st.st_mode)) {
			error("Path exists but is not a directory: '%s'\n", dir_path);
			goto err;
		}
	}
	free(dir_path);

	return 0;

err:
	free(dir_path);

	return -1;
}

static double intv_to_fps(const struct v4l2_fract *v)
{
	if (v->numerator)
		return (double)v->denominator / v->numerator;

	return 0.0;
}

static void simplify_fract(struct v4l2_fract *v)
{
	__u32 a = v->numerator;
	__u32 b = v->denominator;
	while (b != 0) {
		__u32 temp = b;
		b = a % b;
		a = temp;
	}
	v->numerator /= a;
	v->denominator /= a;
}

static void fps_to_intv(double fps, struct v4l2_fract *v)
{
	v->numerator = 1000;
	v->denominator = (__u32)(fps * 1000);
	simplify_fract(v);
}

static void print_fmt(struct v4l2_format *fmt)
{
	message("Format %s:\n", buf_type_str(fmt->type));

	switch (fmt->type) {
	case V4L2_BUF_TYPE_VIDEO_CAPTURE:
		message1("Width/Height  : %u/%u\n", fmt->fmt.pix.width,
				 fmt->fmt.pix.height);
		message1("Pixel Format  : " FMT_4CC "\n",
				 ARG_4CC(fmt->fmt.pix.pixelformat));
		message1("Field         : %u\n", fmt->fmt.pix.field);
		message1("Bytes per Line: %u\n", fmt->fmt.pix.bytesperline);
		message1("Size Image    : %u\n", fmt->fmt.pix.sizeimage);
		message1("Color Space   : %s\n",
				 colorspace_str(fmt->fmt.pix.colorspace));
		break;

	default:
		message1("Not implemented !!!\n");
		break;
	}
}

static int find_framerate(void)
{
	int ret;

	for (int i = 0;; i++) {
		struct v4l2_fmtdesc fmt = {
			.index = i,
			.type = V4L2_BUF_TYPE_VIDEO_CAPTURE,
		};

		ret = v4l2_ioctl(VIDIOC_ENUM_FMT, &fmt);
		if (ret < 0)
			break;

		if (fmt.pixelformat != cam.pixelformat)
			continue;

		for (int j = 0;; j++) {
			struct v4l2_frmsizeenum size = {
				.index = j,
				.pixel_format = fmt.pixelformat,
			};

			ret = v4l2_ioctl(VIDIOC_ENUM_FRAMESIZES, &size);
			if (ret < 0)
				break;

			if (size.type == V4L2_FRMSIZE_TYPE_DISCRETE) {
				if (size.discrete.width != cam.width ||
					size.discrete.height != cam.height)
					continue;

				double max_fps = 0.0;
				struct v4l2_fract max_timeperframe = {};

				cam.fps = 120.0; // set max frame rate

				for (int k = 0;; k++) {
					struct v4l2_frmivalenum ival = {
						.index = k,
						.pixel_format = fmt.pixelformat,
						.width = size.discrete.width,
						.height = size.discrete.height,
					};

					ret = v4l2_ioctl(VIDIOC_ENUM_FRAMEINTERVALS, &ival);
					if (ret < 0)
						break;

					if (ival.type == V4L2_FRMIVAL_TYPE_DISCRETE) {
						double fps = intv_to_fps(&ival.discrete);

						if (fps >= args.fps) {
							if (fps < cam.fps) {
								cam.fps = fps;
								cam.timeperframe = ival.discrete;
								if (fps == args.fps)
									break;
							}
						} else if (fps > max_fps) {
							max_fps = fps;
							max_timeperframe = ival.discrete;
						}
					} else {
						// TODO: ...
					}
				}

				if (!cam.timeperframe.denominator && max_fps > 0.0) {
					// Use max frame rate
					cam.fps = max_fps;
					cam.timeperframe = max_timeperframe;
				}

				if (cam.timeperframe.denominator) {
					message("Select framerate. %d/%d(%.03ffps)\n",
							cam.timeperframe.denominator,
							cam.timeperframe.numerator, cam.fps);
					return 0;
				}
			}
		}
	}

	return -1;
}

static int desc_fmt(enum v4l2_buf_type type)
{
	message1("Type: %s\n", buf_type_str(type));

	for (int i = 0;; i++) {
		struct v4l2_fmtdesc fmt;
		int ret;

		memset(&fmt, 0, sizeof(fmt));
		fmt.index = i;
		fmt.type = type;

		ret = v4l2_ioctl(VIDIOC_ENUM_FMT, &fmt);
		if (ret < 0)
			break;

		message2("[%d]: '" FMT_4CC "' (%s)\n", i, ARG_4CC(fmt.pixelformat),
				 fmt.description);
		message2("Frame Sizes:\n");
		for (int j = 0;; j++) {
			struct v4l2_frmsizeenum size;

			memset(&size, 0, sizeof(size));
			size.index = j;
			size.pixel_format = fmt.pixelformat;

			ret = v4l2_ioctl(VIDIOC_ENUM_FRAMESIZES, &size);
			if (ret < 0)
				break;

			if (size.type == V4L2_FRMSIZE_TYPE_DISCRETE) {
				message3("%4dx%-4d :", size.discrete.width,
						 size.discrete.height);

				for (int k = 0;; k++) {
					struct v4l2_frmivalenum ival;

					memset(&ival, 0, sizeof(ival));
					ival.index = k;
					ival.pixel_format = fmt.pixelformat;
					ival.width = size.discrete.width;
					ival.height = size.discrete.height;

					ret = v4l2_ioctl(VIDIOC_ENUM_FRAMEINTERVALS, &ival);
					if (ret < 0)
						break;

					if (ival.type == V4L2_FRMIVAL_TYPE_DISCRETE) {
						message(" %d/%d(%.01ffps)", ival.discrete.numerator,
								ival.discrete.denominator,
								intv_to_fps(&ival.discrete));
					} else {
						// Not implemented
						message(" X(%d)", ival.type);
					}
				}
				message("\n");
			} else if (size.type == V4L2_FRMSIZE_TYPE_CONTINUOUS) {
				message3("%ux%u - %ux%u\n", size.stepwise.min_width,
						 size.stepwise.min_height, size.stepwise.max_width,
						 size.stepwise.max_height);
			} else if (size.type == V4L2_FRMSIZE_TYPE_STEPWISE) {
				message3("%ux%u - %ux%u with step %u/%u\n",
						 size.stepwise.min_width, size.stepwise.min_height,
						 size.stepwise.max_width, size.stepwise.max_height,
						 size.stepwise.step_width, size.stepwise.step_height);
			}
		}
	}

	if (type == V4L2_BUF_TYPE_VIDEO_CAPTURE) {
		int ret;
		struct v4l2_streamparm param = {};

		param.type = type;
		ret = v4l2_ioctl(VIDIOC_G_PARM, &param);
		if (ret < 0)
			message("VIDIOC_G_PARM failed. %s\n", strerror(errno));
		else {
			struct v4l2_fract *tf = &param.parm.capture.timeperframe;

			message1("Streaming Parameters Video Capture:\n");
			if (param.parm.capture.capability & V4L2_CAP_TIMEPERFRAME)
				message2("Capabilities     : timeperframe\n");
			if (param.parm.capture.capturemode & V4L2_MODE_HIGHQUALITY)
				message2("Capture mode     : high quality\n");

			if (!tf->denominator || !tf->numerator) {
				message2("Frames per second: invalid (%d/%d)\n",
						 tf->denominator, tf->numerator);
			} else {
				message2("Frames per second: %.3f (%d/%d)\n",
						 (1.0 * tf->denominator) / tf->numerator,
						 tf->denominator, tf->numerator);
			}
			message2("Read buffers     : %d\n", param.parm.capture.readbuffers);
		}
	}

	return 0;
}

static void print_caps_field(__u32 caps)
{
	int i;

#define define_field(n) { #n, n }

	const struct {
		const char *name;
		unsigned int bits;
	} fields[] = {
		define_field(V4L2_CAP_VIDEO_CAPTURE),
		define_field(V4L2_CAP_VIDEO_OUTPUT),
		define_field(V4L2_CAP_VIDEO_OVERLAY),
		define_field(V4L2_CAP_VBI_CAPTURE),
		define_field(V4L2_CAP_VBI_OUTPUT),
		define_field(V4L2_CAP_SLICED_VBI_CAPTURE),
		define_field(V4L2_CAP_SLICED_VBI_OUTPUT),
		define_field(V4L2_CAP_RDS_CAPTURE),
		define_field(V4L2_CAP_VIDEO_OUTPUT_OVERLAY),
		define_field(V4L2_CAP_HW_FREQ_SEEK),
		define_field(V4L2_CAP_RDS_OUTPUT),
		define_field(V4L2_CAP_VIDEO_CAPTURE_MPLANE),
		define_field(V4L2_CAP_VIDEO_OUTPUT_MPLANE),
		define_field(V4L2_CAP_VIDEO_M2M_MPLANE),
		define_field(V4L2_CAP_VIDEO_M2M),
		define_field(V4L2_CAP_TUNER),
		define_field(V4L2_CAP_AUDIO),
		define_field(V4L2_CAP_RADIO),
		define_field(V4L2_CAP_MODULATOR),
		define_field(V4L2_CAP_SDR_CAPTURE),
#ifdef V4L2_CAP_EXT_PIX_FORMAT
		define_field(V4L2_CAP_EXT_PIX_FORMAT),
#endif
#ifdef V4L2_CAP_SDR_OUTPUT
		define_field(V4L2_CAP_SDR_OUTPUT),
#endif
#ifdef V4L2_CAP_META_CAPTURE
		define_field(V4L2_CAP_META_CAPTURE),
#endif
		define_field(V4L2_CAP_READWRITE),
		define_field(V4L2_CAP_ASYNCIO),
		define_field(V4L2_CAP_STREAMING),
#ifdef V4L2_CAP_TOUCH
		define_field(V4L2_CAP_TOUCH),
#endif
		define_field(V4L2_CAP_DEVICE_CAPS),
		{},
	};

	for (i = 0; fields[i].name; i++) {
		if (caps & fields[i].bits)
			message2("%s\n", fields[i].name);
	}
}

static int parse_caps(void)
{
	int ret;
	__u32 capabilities;
	struct v4l2_capability *caps = &cam.caps;

	ret = ioctl(cam.dev_fd, VIDIOC_QUERYCAP, caps);
	if (ret < 0) {
		error("VIDIOC_QUERYCAP failed.\n");
		return ret;
	}

	message("--------\n");
	message("Driver Info:\n");
	message1("driver       %s\n", caps->driver);
	message1("card         %s\n", caps->card);
	message1("bus_info     %s\n", caps->bus_info);
	message1("version      0x%x(%d)\n", caps->version, caps->version);
	message1("capabilities 0x%x\n", caps->capabilities);
	print_caps_field(caps->capabilities);

	if (caps->capabilities & V4L2_CAP_DEVICE_CAPS) {
		message1("device_caps  0x%x\n", caps->device_caps);
		print_caps_field(caps->device_caps);
		capabilities = caps->device_caps;
	} else {
		capabilities = caps->capabilities;
	}

	message("List Formats:\n");
#define do_desc_fmt(n)                                                         \
	do {                                                                       \
		if (capabilities & V4L2_CAP_##n)                                       \
			desc_fmt(V4L2_BUF_TYPE_##n);                                       \
	} while (0)

	do_desc_fmt(VIDEO_CAPTURE);
	do_desc_fmt(VIDEO_OUTPUT);
	do_desc_fmt(VIDEO_OVERLAY);
	do_desc_fmt(VBI_CAPTURE);
	do_desc_fmt(VBI_OUTPUT);
	do_desc_fmt(SLICED_VBI_CAPTURE);
	do_desc_fmt(SLICED_VBI_OUTPUT);
	do_desc_fmt(VIDEO_OUTPUT_OVERLAY);
	do_desc_fmt(VIDEO_CAPTURE_MPLANE);
	do_desc_fmt(VIDEO_OUTPUT_MPLANE);
	do_desc_fmt(SDR_CAPTURE);
#ifdef SDR_OUTPUT
	do_desc_fmt(SDR_OUTPUT);
#endif
#ifdef V4L2_CAP_META_CAPTURE
	do_desc_fmt(META_CAPTURE);
#endif
#undef do_desc_fmt
	message("--------\n");

	if (!(capabilities & V4L2_CAP_VIDEO_CAPTURE)) {
		error("no capture\n");
		return -1;
	}

	return 0;
}

static double get_frame_time(__u32 frame_count,
							 const struct v4l2_fract *timeperframe)
{
	return (double)frame_count * timeperframe->numerator /
		   timeperframe->denominator;
}

static int process_data(void *data, __u32 size)
{
	if (args.skip_frame_count > 0) {
		cam.skipped_frames++;
		if (cam.skipped_frames < args.skip_frame_count) {
			if (args.debug_level > 0)
				message("skip.   %d/%d\n", cam.skipped_frames,
						args.skip_frame_count);
			return 0;
		}

		if (args.debug_level > 0)
			message("handle. %d/%d\n", cam.skipped_frames,
					args.skip_frame_count);
		cam.skipped_frames = 0;
	}

	if (args.dump_level > 0) {
		if (cam.pixelformat == v4l2_fourcc('H', '2', '6', '4')) {
			int offs;
			int zeros;
			unsigned char *p;
			bool got_start;

			zeros = 0;
			p = data;
			got_start = false;
			for (offs = 0, p = data; (void *)p < data + size; p++, offs++) {
				if (got_start) {
					unsigned char *t = p - zeros;

					message("%02x %02x %02x %02x %02x %02x %02x %02x - NAL type %2d at offs %d\n",
							t[0], t[1], t[2], t[3], t[4], t[5], t[6], t[7],
							*p & 0x1f, offs);
					got_start = false;
					zeros = 0;
				} else {
					if (*p == 0)
						zeros++;
					else if (zeros > 2 && *p == 0x01)
						got_start = true;
					else
						zeros = 0;
				}
			}
		} else if (size >= 8) {
			unsigned char *t = data;
			message("%02x %02x %02x %02x %02x %02x %02x %02x - size %d\n", t[0],
					t[1], t[2], t[3], t[4], t[5], t[6], t[7], size);
		} else
			message("Too short data buffer size. %d\n", size);
	}

	if (args.drop_broken &&
		cam.pixelformat == v4l2_fourcc('M', 'J', 'P', 'G')) {
		unsigned char *t = data;
		int data_ok = 0;

		if (size < 4)
			message("Too short jpeg data. size %d\n", size);
		else if (t[0] != 0xff || t[1] != 0xd8 || t[2] != 0xff)
			message("wrong jpeg header. %02x %02x %02x %02x\n", t[0], t[1],
					t[2], t[3]);
		else
			data_ok = 1;

		if (!data_ok) {
			message("wrong data. drop this frame.\n");
			return 0;
		}
	}

	if (cam.all_frame_fd >= 0) {
		ssize_t written;
		written = write(cam.all_frame_fd, data, size);
		assert(written == size);
	}

	if (args.filename[FILE_TYPE_LAST_FRAME] ||
		args.filename[FILE_TYPE_SEPERATE_FRAME]) {
		char *tmp_fname = NULL;
		char *out_fname = NULL;

		if (args.filename[FILE_TYPE_TEMP])
			tmp_fname = strdup(args.filename[FILE_TYPE_TEMP]);

		if (args.filename[FILE_TYPE_LAST_FRAME]) {
			out_fname = strdup(args.filename[FILE_TYPE_LAST_FRAME]);
		} else {
			int ret;
			ret = asprintf(&out_fname, args.filename[FILE_TYPE_SEPERATE_FRAME],
						   cam.seperate_frame_num);
			assert(ret >= 0);
			cam.seperate_frame_num++;
			if (args.num_files_to_save &&
				cam.seperate_frame_num >= args.num_files_to_save) {
				cam.seperate_frame_num = 0;
			}
		}

		if (out_fname) {
			int out;
			char *w_fname = out_fname;

			if (tmp_fname)
				w_fname = tmp_fname;

			out = open(w_fname, O_WRONLY | O_CREAT | O_TRUNC, 0644);
			if (out >= 0) {
				ssize_t written;

				written = write(out, data, size);
				assert(written == size);
				if (args.debug_level > 0)
					message("%s: %zd written\n", out_fname, written);
				close(out);

				if (tmp_fname) {
					if (rename(tmp_fname, out_fname) < 0) {
						error("rename('%s', '%s') failed. %s(%d)\n", tmp_fname,
							  out_fname, strerror(errno), errno);
					}
				}
			} else {
				error("open('%s') failed. %s(%d)\n", w_fname, strerror(errno),
					  errno);
			}

			free(out_fname);
		}

		if (tmp_fname)
			free(tmp_fname);
	}

	return 0;
}

static int set_format(void)
{
	int ret;
	struct v4l2_format fmt = {};

	fmt.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
	ret = v4l2_ioctl(VIDIOC_G_FMT, &fmt);
	if (ret < 0) {
		error("VIDIOC_G_FMT failed.\n");
		return -1;
	}

	/* set format */
	if ((args.width && args.height) ||
		(args.pixelformat != fmt.fmt.pix.pixelformat)) {
		message("Set Format\n");
		if (args.width && args.height) {
			fmt.fmt.pix.width = args.width;
			fmt.fmt.pix.height = args.height;
		}
		if (args.pixelformat)
			fmt.fmt.pix.pixelformat = args.pixelformat;
		fmt.fmt.pix.field = V4L2_FIELD_ANY;
		//fmt.fmt.pix.bytesperline = 0;
		//fmt.fmt.pix.sizeimage = 0;
		//fmt.fmt.pix.colorspace = V4L2_COLORSPACE_DEFAULT;

		ret = v4l2_ioctl(VIDIOC_S_FMT, &fmt);
		if (ret < 0) {
			error("VIDIOC_S_FMT failed.\n");
			return ret;
		}

		ret = v4l2_ioctl(VIDIOC_G_FMT, &fmt);
		if (ret < 0) {
			error("VIDIOC_G_FMT failed.\n");
			return ret;
		}

		if (fmt.fmt.pix.pixelformat != args.pixelformat) {
			// TODO: error if not set
		}
	}
	print_fmt(&fmt);

	cam.pixelformat = fmt.fmt.pix.pixelformat;
	cam.width = fmt.fmt.pix.width;
	cam.height = fmt.fmt.pix.height;

	return 0;
}

static int set_framerate(void)
{
	int ret;
	struct v4l2_streamparm streamparm = {};

	ret = find_framerate();
	if (ret < 0) {
		error("Can't find framerate\n");
		return ret;
	}

	message("Set Frame Rate\n");

	streamparm.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
	ret = v4l2_ioctl(VIDIOC_G_PARM, &streamparm);
	if (ret < 0) {
		error("VIDIOC_G_PARM failed.\n");
		return ret;
	}

	message1("device fps %.03f, display fps %.03f\n", cam.fps, args.fps);
	streamparm.parm.capture.timeperframe = cam.timeperframe;
	ret = v4l2_ioctl(VIDIOC_S_PARM, &streamparm);
	if (ret < 0) {
		error("VIDIOC_S_PARM failed.\n");
		return ret;
	}

	return 0;
}

static int req_buffer(void)
{
	int ret;
	struct v4l2_requestbuffers reqbufs = {};

	/* request buffer and map */
	reqbufs.count = MAX_BUFFER;
	reqbufs.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
	reqbufs.memory = V4L2_MEMORY_MMAP;
	ret = v4l2_ioctl(VIDIOC_REQBUFS, &reqbufs);
	if (ret < 0) {
		error("VIDIOC_REQBUFS failed.\n");
		return ret;
	}
	cam.num_buf = reqbufs.count;

	for (int i = 0; i < cam.num_buf; i++) {
		struct v4l2_buffer *vb = &cam.buf[i].vb;

		vb->index = i;
		vb->type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
		ret = v4l2_ioctl(VIDIOC_QUERYBUF, vb);
		if (ret < 0) {
			error("VIDIOC_QUERYBUF failed.\n");
			return ret;
		}

		cam.buf[i].mem = mmap(NULL, vb->length, PROT_READ, MAP_SHARED,
							  cam.dev_fd, vb->m.offset);
		if (cam.buf[i].mem == MAP_FAILED) {
			error("mmap() failed for buf[%d]\n", i);
			return -1;
		}
		message("buf[%d]: %08u++%u, flags=0x%x, mem=%p\n", i, vb->m.offset,
				vb->length, vb->flags, cam.buf[i].mem);

		if (!(vb->flags & V4L2_BUF_FLAG_QUEUED)) {
			ret = v4l2_ioctl(VIDIOC_QBUF, vb);
			if (ret < 0) {
				error("VIDIOC_QBUF failed.\n");
				return ret;
			}
		}
	}

	return 0;
}

static int save_config(void)
{
	FILE *f = fopen(args.filename[FILE_TYPE_CONFIG], "w");
	if (!f) {
		error("cannot fopen %s\n", args.filename[FILE_TYPE_CONFIG]);
		return -1;
	}
	fprintf(f,
			"{\n"
			"  \"format\": \"" FMT_4CC "\",\n"
			"  \"width\": %u,\n"
			"  \"height\": %u,\n"
			"  \"fps\": %.02f,\n"
			"}\n",
			ARG_4CC(cam.pixelformat), cam.width, cam.height, cam.fps);
	fclose(f);

	return 0;
}

static int capture_event(void)
{
	int ret;
	struct v4l2_buffer vb;
	double device_time, display_time;

	/* dequeue */
	memset(&vb, 0, sizeof(vb));

	vb.type = V4L2_BUF_TYPE_VIDEO_CAPTURE;
	ret = v4l2_ioctl(VIDIOC_DQBUF, &vb);
	if (ret < 0) {
		error("VIDIOC_DQBUF failed.\n");
		return ret;
	}

	if (args.debug_level > 0) {
		char str[3 * 8 + 1];

		for (int i = 0; i < 8 && i < vb.bytesused; i++)
			sprintf(str + 3 * i, " %02x", ((__u8 *)cam.buf[vb.index].mem)[i]);

		message("%4d:%4d. buf[%d] flags 0x%x, bytes %6d, field %d, seq %5d, data:%s\n",
				cam.frame_count, cam.disp_count, vb.index, vb.flags,
				vb.bytesused, vb.field, vb.sequence, str);
	}

	device_time = get_frame_time(cam.frame_count, &cam.timeperframe);
	display_time = get_frame_time(cam.disp_count, &cam.disp_timeperframe);

	if (device_time < display_time) {
		if (args.debug_level > 0)
			message("skip frame..\n");
	} else {
		process_data(cam.buf[vb.index].mem, vb.bytesused);
		cam.disp_count++;
	}

	ret = v4l2_ioctl(VIDIOC_QBUF, &vb);
	if (ret < 0) {
		error("VIDIOC_DQBUF failed.\n");
		return ret;
	}

	cam.frame_count++;

	return 0;
}

static int send_socket(__u16 type, const void *data, __u32 size)
{
	int ret;
	struct cap_msg *msg;
	__u32 msg_size = sizeof(struct cap_msg) + size;

	msg = malloc(msg_size);
	assert(msg != NULL);

	msg->magic = CAP_MSG_MAGIC;
	msg->type = type;
	msg->size = size;
	memcpy(msg->payload, data, size);

	ret = write(cam.sock_fd, msg, msg_size);
	if (ret == msg_size) {
		ret = 0;
	} else {
		error("socket write(%u) error(%d)\n", msg_size, ret);
		ret = -1;
	}

	free(msg);

	return ret;
}

static int send_cam_info(void)
{
	int ret;

#if 0
	char *data;

	ret = asprintf(&data,
				   "{"
				   "\"format\": \"" FMT_4CC "\","
				   "\"width\": %u,"
				   "\"height\": %u,"
				   "\"fps\": %.02f,"
				   "}",
				   ARG_4CC(cam.pixelformat), cam.width, cam.height, cam.fps);
	assert(ret >= 0);
	ret = send_socket(CAP_MSG_TYPE_CAM_INFO, data, strlen(data));
	free(data);
#else
	struct cap_cam_info data;

	data.format = cam.pixelformat;
	data.width = cam.width;
	data.height = cam.height;
	data.fps = cam.fps;

	ret = send_socket(CAP_MSG_TYPE_CAM_INFO, &data, sizeof(data));
#endif

	return ret;
}

static int connect_socket(void)
{
	int fd;
	struct sockaddr_un addr;

	if (!cam.use_sock) {
		return 0;
	}

	if (cam.sock_fd >= 0) {
		message("socket already connected\n");
		return 0;
	}

	fd = socket(AF_UNIX, SOCK_STREAM, 0);
	if (fd < 0) {
		error("socket error(%s)\n", strerror(errno));
		return -1;
	}

	memset(&addr, 0, sizeof(addr));
	addr.sun_family = AF_UNIX;
	strncpy(addr.sun_path, args.filename[FILE_TYPE_SOCKET],
			sizeof(addr.sun_path) - 1);

	if (connect(fd, (struct sockaddr *)&addr, sizeof(addr)) < 0) {
		error("Can't connect to '%s'\n", args.filename[FILE_TYPE_SOCKET]);
		close(fd);
		return -1;
	}

	cam.sock_fd = fd;

	send_cam_info();

	return 0;
}

static void disconnect_socket(void)
{
	if (cam.sock_fd > 0) {
		close(cam.sock_fd);
		cam.sock_fd = -1;
	}
}

static int socket_event(void)
{
	int ret;
	struct cap_msg msg;

	ret = read(cam.sock_fd, &msg, sizeof(msg));

	message("socket event. ret=%d\n", ret);

	if (ret == 0) {
		disconnect_socket();
	}

	//if (msg.type == SOCK_PKT_TYPE_COMMAND) {
	//}
	// TODO:

	return 0;
}

static int check_socket(void)
{
	if (!cam.use_sock)
		return -1;

	if (cam.sock_fd < 0) {
		// retry ...

		return -1;
	}

	return 0;
}

static int init_socket(void)
{
	cam.sock_fd = -1;
	cam.use_sock = args.filename[FILE_TYPE_SOCKET] ? true : false;

	return (cam.use_sock) ? connect_socket() : 0;
}

static void release_socket(void)
{
	disconnect_socket();
}

static int init_device(void)
{
	int ret;

	cam.dev_fd = open(args.dev_name, O_RDWR);
	if (cam.dev_fd < 0) {
		error("open failed. %s\n", args.dev_name);
		return -1;
	}

	ret = parse_caps();
	if (ret < 0)
		goto failed;

	ret = set_format();
	if (ret < 0)
		goto failed;

	ret = set_framerate();
	if (ret < 0)
		goto failed;

	ret = req_buffer();
	if (ret < 0)
		goto failed;

	if (args.filename[FILE_TYPE_CONFIG]) {
		ret = save_config();
		if (ret < 0)
			goto failed;
	}

	return 0;

failed:
	close(cam.dev_fd);
	cam.dev_fd = -1;

	return -1;
}

static void release_device(void)
{
	if (cam.dev_fd >= 0) {
		close(cam.dev_fd);
		cam.dev_fd = -1;
	}
}

static int set_streaming(bool on)
{
	int ret;
	unsigned long cmd = on ? VIDIOC_STREAMON : VIDIOC_STREAMOFF;
	int arg = V4L2_BUF_TYPE_VIDEO_CAPTURE;

	ret = v4l2_ioctl(cmd, &arg);
	if (ret < 0) {
		error("VIDIOC_STREAM%s failed\n", on ? "ON" : "OFF");
		return ret;
	}

	return 0;
}

static int v4l2_capture(void)
{
	int ret;
	struct pollfd fds[2] = {};
	nfds_t nfds;

	fps_to_intv(args.fps, &cam.disp_timeperframe);

	message("Device Name  : \"%s\"\n", args.dev_name);
	message("Pixel Format : " FMT_4CC "\n", ARG_4CC(args.pixelformat));
	message("Frame Rate   : %u/%u(%.02ffps)\n",
			cam.disp_timeperframe.denominator, cam.disp_timeperframe.numerator,
			args.fps);

	if (args.fps <= 0) {
		error("Invalid frame rate\n");
		return -1;
	}

	ret = init_device();
	if (ret < 0) {
		error("device init failed\n");
		return -1;
	}

	init_socket();

	ret = set_streaming(true);
	if (ret < 0)
		goto done;

	cam.running = true;

	fds[0].fd = cam.dev_fd;
	fds[0].events = POLLIN;
	nfds = 1;

	while (cam.running) {
		if (cam.use_sock) {
			if (check_socket() == 0) {
				fds[1].fd = cam.sock_fd;
				fds[1].events = POLLIN;
				nfds = 2;
			} else {
				nfds = 1;
			}
		}

		ret = poll(fds, nfds, -1);
		if (ret < 0) {
			error("poll failed.\n");
			goto done;
		}

		if (fds[0].revents & POLLIN) {
			capture_event();
		}

		if (nfds > 1) {
			if (fds[1].revents & POLLIN) {
				socket_event();
			}
		}
	}

	set_streaming(false);

done:
	release_socket();
	release_device();

	return ret;
}

static int mk_dirs(void)
{
	for (int i = 0; i < NUM_FILE_TYPE; i++) {
		if (args.filename[i]) {
			if (mk_file_dir(args.filename[i]))
				return -1;
		}
	}

	return 0;
}

static int init_files(void)
{
	if (mk_dirs())
		return -1;

	if (args.filename[FILE_TYPE_PID]) {
		message("pid file \"%s\"\n", args.filename[FILE_TYPE_PID]);
		FILE *f = fopen(args.filename[FILE_TYPE_PID], "w");
		if (!f) {
			error("cannot fopen %s\n", args.filename[FILE_TYPE_PID]);
			return -1;
		}
		fprintf(f, "%d\n", (int)getpid());
		fclose(f);
	}

	if (args.filename[FILE_TYPE_ALL_FRAME]) {
		int fd = open(args.filename[FILE_TYPE_ALL_FRAME],
					  O_CREAT | O_WRONLY | O_TRUNC, 0644);
		if (fd < 0) {
			error("Can't create '%s'\n", args.filename[FILE_TYPE_ALL_FRAME]);
			return -1;
		}
		cam.all_frame_fd = fd;
	} else {
		cam.all_frame_fd = -1;
	}

	return 0;
}

static void handle_sig(int sig)
{
	fprintf(stderr, "signal.. %d\n", sig);

	cam.running = false;

	if (args.filename[FILE_TYPE_PID])
		unlink(args.filename[FILE_TYPE_PID]);
}

static void set_default_args(void)
{
	args.dev_name = "/dev/video0";
	args.pixelformat = v4l2_fourcc('M', 'J', 'P', 'G');
	args.fps = 5.0;
}

static void help(const char *name)
{
	fprintf(stderr,
			"$ %s <options>\n"
			"options:\n"
			" -d <devname>          : v4l2 device name. default:%s\n"
			" -w <width>            : width of captured screen\n"
			" -h <height>           : height of captured screen\n"
			" -f <pixelformat>      : pixel format. default:" FMT_4CC "\n"
			" -o <filename>         : filename for saving all frames in a single file\n"
			" -s <filename>         : filename for saving the last frame only\n"
			" -S <filename>         : filename format for saving the each frame. include %%d for the image number\n"
			" -n <num files>        : option for -S. 0: continuous increase, else saves in a loop. default:%u\n"
			" -t <temp filename>    : temp filename for \"-s\" or \"-S\" option\n"
			" -c <filename>         : filename for saving configurations in JSON format\n"
			" -u <path>             : unix domain socket path for communication\n"
			" -x <dump level>       : console stream dump level\n"
			" -k <frame skip count> : 0 or 1 for no skip. 5 for skip 4 frames skip for every 5 frames\n"
			" -p <pid filename>     : pid filename\n"
			" -D                    : increase debug level\n"
			" -r <frame rate>       : framerate(floating-point)\n"
			" -b                    : drop broken data\n",
			name, args.dev_name, ARG_4CC(args.pixelformat),
			args.num_files_to_save);
}

int main(int argc, char **argv)
{
	set_default_args();

	while (1) {
		int opt;

		opt = getopt(argc, argv, "?d:w:h:f:o:s:S:n:t:c:u:x:k:p:Dr:b");
		if (opt < 0)
			break;

		switch (opt) {
		case '?':
			help(argv[0]);
			exit(1);
		case 'd':
			args.dev_name = optarg;
			break;

		case 'w':
			args.width = atoi(optarg);
			break;

		case 'h':
			args.height = atoi(optarg);
			break;

		case 'f':
			if (strlen(optarg) < 4) {
				fprintf(stderr, "-f require fourcc(4 characters)\n");
				exit(1);
			}
			args.pixelformat =
					v4l2_fourcc(optarg[0], optarg[1], optarg[2], optarg[3]);
			break;

		case 'o':
			args.filename[FILE_TYPE_ALL_FRAME] = optarg;
			break;

		case 's':
			args.filename[FILE_TYPE_LAST_FRAME] = optarg;
			break;

		case 'S':
			args.filename[FILE_TYPE_SEPERATE_FRAME] = optarg;
			break;

		case 'n':
			args.num_files_to_save = atoi(optarg);
			break;

		case 't':
			args.filename[FILE_TYPE_TEMP] = optarg;
			break;

		case 'c':
			args.filename[FILE_TYPE_CONFIG] = optarg;
			break;

		case 'u':
			args.filename[FILE_TYPE_SOCKET] = optarg;
			break;

		case 'x':
			args.dump_level = atoi(optarg);
			break;

		case 'k':
			args.skip_frame_count = atoi(optarg);
			break;

		case 'p':
			args.filename[FILE_TYPE_PID] = optarg;
			break;

		case 'D':
			args.debug_level++;
			break;

		case 'r':
			args.fps = atof(optarg);
			break;

		case 'b':
			args.drop_broken = true;
			break;
		}
	}

	signal(SIGINT, handle_sig);
	signal(SIGHUP, handle_sig);
	signal(SIGTERM, handle_sig);

	if (init_files())
		exit(1);

	v4l2_capture();

	return 0;
}
