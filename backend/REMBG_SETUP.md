# RemBG Setup Guide

## 1. Install Python Dependencies

### Option A: Automatic Installation (Windows)
Run the batch file:
```
backend/install_rembg_deps.bat
```

### Option B: Manual Installation
```bash
pip install --upgrade pip
pip install rembg[new]
pip install onnxruntime
pip install aiohttp  
pip install filetype
pip install pillow
pip install numpy
pip install requests
```

## 2. Verify Installation

Test the rembg script:
```bash
cd backend/src
python rembg_script.py test_input.jpg test_output.png
```

## 3. Common Issues

### ModuleNotFoundError: No module named 'xxx'
- Install the missing module: `pip install <module_name>`
- Common missing modules: onnxruntime, aiohttp, filetype

### Python not found
- Make sure Python is installed and in your PATH
- Try using `python3` instead of `python`

### CUDA/GPU Issues
- For CPU-only: `pip install onnxruntime`
- For GPU support: `pip install onnxruntime-gpu`

## 4. Model Download
First time usage will download the AI model (~23MB).
This may take some time depending on your internet connection.

## 5. Performance Notes
- First run is slower due to model loading
- Subsequent runs are faster
- Image size affects processing time
- CPU usage: ~2-5 seconds per image
- GPU usage: ~0.5-1 seconds per image