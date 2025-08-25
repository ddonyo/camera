@echo off
echo Installing rembg and its dependencies...

pip install --upgrade pip
pip install rembg[new]
pip install onnxruntime
pip install aiohttp
pip install filetype
pip install pillow
pip install numpy
pip install requests

echo.
echo Installation completed!
echo You can now use rembg functionality.
pause