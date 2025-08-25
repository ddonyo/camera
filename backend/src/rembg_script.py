#!/usr/bin/env python3
"""
Background removal script using rembg
Usage: python rembg_script.py <input_path> <output_path>
"""

import sys
import os
from pathlib import Path

def main():
    if len(sys.argv) != 3:
        print("Usage: python rembg_script.py <input_path> <output_path>", file=sys.stderr)
        sys.exit(1)
    
    input_path = sys.argv[1]
    output_path = sys.argv[2]
    
    # Check if input file exists
    if not os.path.exists(input_path):
        print(f"Error: Input file does not exist: {input_path}", file=sys.stderr)
        sys.exit(1)
    
    try:
        # Import rembg modules
        from rembg import remove
        from PIL import Image
        
        print(f"Processing: {input_path} -> {output_path}")
        
        # Open input image
        with open(input_path, 'rb') as input_file:
            input_data = input_file.read()
        
        # Remove background
        output_data = remove(input_data)
        
        # Save output image
        with open(output_path, 'wb') as output_file:
            output_file.write(output_data)
        
        print(f"Background removal completed successfully")
        sys.exit(0)
        
    except ImportError as e:
        print(f"Error: Missing required package: {e}", file=sys.stderr)
        print("Please install rembg and its dependencies:", file=sys.stderr)
        print("pip install rembg[new] onnxruntime aiohttp filetype pillow numpy", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"Error during background removal: {e}", file=sys.stderr)
        sys.exit(1)

if __name__ == "__main__":
    main()