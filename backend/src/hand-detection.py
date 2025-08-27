#!/usr/bin/env python3
"""
Hand detection worker using MediaPipe
Processes frames and outputs hand landmarks with handedness info
"""

import sys
import json
import time
import cv2
import numpy as np
from io import BytesIO
import base64

try:
    import mediapipe as mp
except ImportError:
    print(json.dumps({"error": "mediapipe not installed. Run: pip install mediapipe opencv-python"}))
    sys.exit(1)

class HandDetector:
    def __init__(self, config=None):
        if config is None:
            config = {
                "max_num_hands": 2,
                "min_detection_confidence": 0.5,
                "min_tracking_confidence": 0.5
            }
        
        self.mp_hands = mp.solutions.hands
        self.hands = self.mp_hands.Hands(
            static_image_mode=False,
            max_num_hands=config.get("max_num_hands", 2),
            min_detection_confidence=config.get("min_detection_confidence", 0.5),
            min_tracking_confidence=config.get("min_tracking_confidence", 0.5)
        )
        
        self.mp_drawing = mp.solutions.drawing_utils
        
    def process_frame(self, image_data, format='base64'):
        """
        Process a single frame and detect hands
        
        Args:
            image_data: Image data (base64 string or numpy array)
            format: 'base64' or 'numpy'
            
        Returns:
            dict with detection results
        """
        try:
            # Convert input to numpy array
            if format == 'base64':
                # Decode base64 to bytes
                image_bytes = base64.b64decode(image_data)
                # Convert bytes to numpy array
                np_array = np.frombuffer(image_bytes, np.uint8)
                # Decode image
                image = cv2.imdecode(np_array, cv2.IMREAD_COLOR)
            elif format == 'numpy':
                image = image_data
            else:
                raise ValueError("Unsupported format")
                
            if image is None:
                return {"error": "Failed to decode image"}
                
            # Convert BGR to RGB (MediaPipe uses RGB)
            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Process the image
            results = self.hands.process(rgb_image)
            
            # Extract hand information
            hands_info = []
            
            if results.multi_hand_landmarks and results.multi_handedness:
                for hand_landmarks, handedness in zip(results.multi_hand_landmarks, results.multi_handedness):
                    # Get handedness (Left/Right)
                    hand_label = handedness.classification[0].label
                    hand_confidence = handedness.classification[0].score
                    
                    # Get bounding box
                    landmarks = []
                    x_coords = []
                    y_coords = []
                    
                    for landmark in hand_landmarks.landmark:
                        x, y = landmark.x, landmark.y
                        landmarks.append({"x": x, "y": y, "z": landmark.z})
                        x_coords.append(x)
                        y_coords.append(y)
                    
                    # Calculate bounding box (normalized coordinates)
                    bbox = {
                        "x1": min(x_coords),
                        "y1": min(y_coords), 
                        "x2": max(x_coords),
                        "y2": max(y_coords)
                    }
                    
                    # Calculate center point
                    center = {
                        "x": (bbox["x1"] + bbox["x2"]) / 2,
                        "y": (bbox["y1"] + bbox["y2"]) / 2
                    }
                    
                    hands_info.append({
                        "handedness": hand_label,  # "Left" or "Right" 
                        "confidence": hand_confidence,
                        "bbox": bbox,
                        "center": center,
                        "landmarks": landmarks
                    })
            
            return {
                "success": True,
                "hands": hands_info,
                "timestamp": time.time()
            }
            
        except Exception as e:
            return {
                "success": False,
                "error": str(e),
                "timestamp": time.time()
            }

def main():
    """
    Main loop for processing stdin input
    Expected input: JSON lines with image data
    """
    detector = HandDetector()
    
    try:
        for line in sys.stdin:
            line = line.strip()
            if not line:
                continue
                
            try:
                # Parse input
                input_data = json.loads(line)
                
                if input_data.get("type") == "process_frame":
                    image_data = input_data.get("image_data")
                    format_type = input_data.get("format", "base64")
                    
                    # Process frame
                    result = detector.process_frame(image_data, format_type)
                    
                    # Output result
                    print(json.dumps(result), flush=True)
                    
                elif input_data.get("type") == "ping":
                    # Health check
                    print(json.dumps({"success": True, "message": "pong"}), flush=True)
                    
                elif input_data.get("type") == "config":
                    # Update configuration
                    new_config = input_data.get("config", {})
                    detector = HandDetector(new_config)
                    print(json.dumps({"success": True, "message": "config updated"}), flush=True)
                    
                else:
                    print(json.dumps({"error": f"Unknown command type: {input_data.get('type')}"}), flush=True)
                    
            except json.JSONDecodeError as e:
                print(json.dumps({"error": f"Invalid JSON: {str(e)}"}), flush=True)
            except Exception as e:
                print(json.dumps({"error": f"Processing error: {str(e)}"}), flush=True)
                
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(json.dumps({"error": f"Fatal error: {str(e)}"}), flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()