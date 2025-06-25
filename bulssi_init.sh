#!/bin/bash

echo "Initializing usb..."
systemctl start lg1k-usb-init

echo "Starting weston..."
systemctl start weston

# npm start
