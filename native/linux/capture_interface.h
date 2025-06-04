#ifndef __CAPTURE_INTERFACE_H__
#define __CAPTURE_INTERFACE_H__

#include <linux/types.h>

// Unix Domain Socket 을 이용한 통신

#define CAP_MSG_MAGIC 0x1CF3

struct cap_msg {
	__u16 magic;
	__u16 type;
	__u32 size;
	__u8 payload[];
};

enum cap_msg_type {
	// To capture device
	CAP_MSG_TYPE_REQ_INFO = 0x100,

	// From capture device
	CAP_MSG_TYPE_CAM_INFO = 0x200,
};

struct cap_cam_info {
	__u32 format;
	__u16 width;
	__u16 height;
	double fps;
};

#endif // __CAPTURE_INTERFACE_H__
