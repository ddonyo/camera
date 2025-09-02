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
    
    def detect_v_gesture(self, landmarks):
        """
        Detect V gesture (Victory/Peace sign)
        V gesture: Index and Middle fingers extended, others folded
        
        MediaPipe landmark indices:
        - Thumb: 1-4
        - Index: 5-8
        - Middle: 9-12
        - Ring: 13-16
        - Pinky: 17-20
        """
        try:
            # Get key landmarks
            thumb_tip = landmarks[4]
            index_tip = landmarks[8]
            index_mcp = landmarks[5]
            middle_tip = landmarks[12]
            middle_mcp = landmarks[9]
            ring_tip = landmarks[16]
            ring_mcp = landmarks[13]
            pinky_tip = landmarks[20]
            pinky_mcp = landmarks[17]
            
            # Check if index finger is extended (tip higher than MCP)
            index_extended = index_tip['y'] < index_mcp['y']
            
            # Check if middle finger is extended
            middle_extended = middle_tip['y'] < middle_mcp['y']
            
            # Check if ring finger is folded
            ring_folded = ring_tip['y'] >= ring_mcp['y']
            
            # Check if pinky is folded
            pinky_folded = pinky_tip['y'] >= pinky_mcp['y']
            
            # V gesture: index and middle extended, ring and pinky folded
            is_v = index_extended and middle_extended and ring_folded and pinky_folded
            
            return is_v
            
        except Exception as e:
            return False
        
    def process_frame(self, image_data, format='base64', crop_info=None):
        """
        Process a single frame and detect hands
        
        Args:
            image_data: Image data (base64 string or numpy array)
            format: 'base64' or 'numpy'
            crop_info: Optional crop information to process only a region
            
        Returns:
            dict with detection results
        """
        try:
            # Convert input to numpy array
            if format == 'base64':
                if not image_data:
                    return {"error": "Empty base64 image data"}
                
                # Decode base64 to bytes
                try:
                    image_bytes = base64.b64decode(image_data)
                except Exception as e:
                    return {"error": f"Base64 decode failed: {str(e)}"}
                
                # Convert bytes to numpy array
                np_array = np.frombuffer(image_bytes, np.uint8)
                
                if np_array.size == 0:
                    return {"error": "Empty numpy array from image bytes"}
                
                # Decode image
                image = cv2.imdecode(np_array, cv2.IMREAD_COLOR)
            elif format == 'numpy':
                image = image_data
            else:
                raise ValueError("Unsupported format")
                
            if image is None:
                return {"error": "Failed to decode image"}
                
            # Apply crop if specified (process only the ROI region)
            if crop_info:
                height, width = image.shape[:2]
                x1 = int(crop_info['offsetX'] * width)
                y1 = int(crop_info['offsetY'] * height)
                x2 = int((crop_info['offsetX'] + crop_info['scaleX']) * width)
                y2 = int((crop_info['offsetY'] + crop_info['scaleY']) * height)
                
                # Ensure valid crop bounds
                x1 = max(0, min(x1, width - 1))
                y1 = max(0, min(y1, height - 1))
                x2 = max(x1 + 1, min(x2, width))
                y2 = max(y1 + 1, min(y2, height))
                
                # Crop the image to ROI
                image = image[y1:y2, x1:x2]
            
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
                        
                        # Transform coordinates back to original image space if cropped
                        if crop_info:
                            x = crop_info['offsetX'] + x * crop_info['scaleX']
                            y = crop_info['offsetY'] + y * crop_info['scaleY']
                        
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
                    
                    # Detect V gesture (Victory/Peace sign)
                    is_v_gesture = self.detect_v_gesture(landmarks)
                    
                    hands_info.append({
                        "handedness": hand_label,  # "Left" or "Right" 
                        "confidence": hand_confidence,
                        "bbox": bbox,
                        "center": center,
                        "landmarks": landmarks,
                        "is_v_gesture": is_v_gesture
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
                    crop_info = input_data.get("crop_info", None)
                    
                    # Process frame
                    result = detector.process_frame(image_data, format_type, crop_info)
                    
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