
ARCH := $(shell uname -m)

ifeq ($(filter $(ARCH), arm aarch64),)
#CROSS_COMPILE	?= aarch64-linux-gnu-
CROSS_COMPILE	?= arm-linux-gnueabihf-
SYSROOT			?= /share/nfs/ks/bulssi/o24
BUILD_CFLAGS	 = --sysroot=$(SYSROOT)
BUILD_LDFLAGS	 =
endif

CC		= $(CROSS_COMPILE)gcc -std=gnu11

TARGET	:= capture

OBJ_DIR	?= ./objs

SRCS	:=
SRCS	+= v4l2_capture.c

OBJS	:= $(addprefix $(OBJ_DIR)/, $(SRCS:.c=.o))

CFLAGS	+= $(BUILD_CFLAGS)
CFLAGS	+= -Wall
CFLAGS	+= -O2
CFLAGS	+= -ggdb

LDFLAGS += $(BUILD_LDFLAGS)

all: $(TARGET)

$(TARGET): $(OBJS)
	$(CC) $(CFLAGS) -o $@ $^ $(LDFLAGS)

$(OBJ_DIR)/%.o: %.c
	@mkdir -p $(@D)
	$(CC) $(CFLAGS) -MD -c "$<" -o "$@"

install: $(TARGET)
	cp $^ $(SYSROOT)/


clean:
	@rm -rf $(OBJ_DIR)
	@rm -f $(TARGET)


ifeq ($(filter clean,$(MAKECMDGOALS)),)
-include $(OBJS:.o=.d)
endif

