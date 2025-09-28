#!/usr/bin/env python3
"""
Pose detection worker using MediaPipe
Processes frames and outputs full body pose detection for recording triggers
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

class PoseDetector:
    def __init__(self, config=None):
        if config is None:
            config = {
                "min_detection_confidence": 0.5,
                "min_tracking_confidence": 0.5,
                "model_complexity": 1
            }
        
        self.mp_pose = mp.solutions.pose
        self.pose = self.mp_pose.Pose(
            static_image_mode=False,
            model_complexity=config.get("model_complexity", 1),
            smooth_landmarks=True,
            min_detection_confidence=config.get("min_detection_confidence", 0.5),
            min_tracking_confidence=config.get("min_tracking_confidence", 0.5)
        )
        
        self.mp_drawing = mp.solutions.drawing_utils
        
        # Define key body landmarks for full body detection
        self.key_landmarks = [
            self.mp_pose.PoseLandmark.NOSE,
            self.mp_pose.PoseLandmark.LEFT_SHOULDER,
            self.mp_pose.PoseLandmark.RIGHT_SHOULDER,
            self.mp_pose.PoseLandmark.LEFT_HIP,
            self.mp_pose.PoseLandmark.RIGHT_HIP,
            self.mp_pose.PoseLandmark.LEFT_KNEE,
            self.mp_pose.PoseLandmark.RIGHT_KNEE,
            self.mp_pose.PoseLandmark.LEFT_ANKLE,
            self.mp_pose.PoseLandmark.RIGHT_ANKLE
        ]
        
        # Define left side landmarks for stop detection
        self.left_side_landmarks = [
            self.mp_pose.PoseLandmark.LEFT_EYE,
            self.mp_pose.PoseLandmark.LEFT_EAR,
            self.mp_pose.PoseLandmark.LEFT_SHOULDER,
            self.mp_pose.PoseLandmark.LEFT_WRIST,
            self.mp_pose.PoseLandmark.LEFT_HIP,
            self.mp_pose.PoseLandmark.LEFT_KNEE
        ]
        
        # Define right side landmarks for stop detection
        self.right_side_landmarks = [
            self.mp_pose.PoseLandmark.RIGHT_EYE,
            self.mp_pose.PoseLandmark.RIGHT_EAR,
            self.mp_pose.PoseLandmark.RIGHT_SHOULDER,
            self.mp_pose.PoseLandmark.RIGHT_WRIST,
            self.mp_pose.PoseLandmark.RIGHT_HIP,
            self.mp_pose.PoseLandmark.RIGHT_KNEE
        ]
    
    def check_full_body_visible(self, landmarks):
        """
        Check if full body is visible in frame
        Returns True if all key landmarks are detected with good confidence
        """
        try:
            if not landmarks:
                return False
            
            # Check visibility of key body parts
            visible_count = 0
            total_confidence = 0
            
            for landmark_id in self.key_landmarks:
                landmark = landmarks.landmark[landmark_id]
                
                # Check visibility (MediaPipe provides visibility score)
                if landmark.visibility > 0.7:  # Threshold for good visibility
                    visible_count += 1
                    total_confidence += landmark.visibility
            
            # Consider full body visible if most key landmarks are detected
            required_visible = len(self.key_landmarks) * 0.8  # 80% of key landmarks
            is_full_body = visible_count >= required_visible
            
            # Calculate average confidence
            avg_confidence = total_confidence / len(self.key_landmarks) if len(self.key_landmarks) > 0 else 0
            
            return is_full_body, avg_confidence
            
        except Exception as e:
            return False, 0
    
    def check_stop_condition(self, landmarks):
        """
        Check if recording should stop based on side visibility
        Stop if either entire left side or entire right side is not visible
        """
        try:
            if not landmarks:
                return True  # Stop if no landmarks
            
            # Check left side visibility
            left_side_invisible_count = 0
            for landmark_id in self.left_side_landmarks:
                landmark = landmarks.landmark[landmark_id]
                if landmark.visibility < 0.3:  # Low visibility threshold
                    left_side_invisible_count += 1
            
            # Check right side visibility
            right_side_invisible_count = 0
            for landmark_id in self.right_side_landmarks:
                landmark = landmarks.landmark[landmark_id]
                if landmark.visibility < 0.3:  # Low visibility threshold
                    right_side_invisible_count += 1
            
            # Stop if all landmarks on either side are not visible
            left_side_gone = left_side_invisible_count == len(self.left_side_landmarks)
            right_side_gone = right_side_invisible_count == len(self.right_side_landmarks)
            
            should_stop = left_side_gone or right_side_gone
            
            # Store debug info for JSON response
            self.stop_debug_info = {
                "left_invisible": left_side_invisible_count,
                "left_total": len(self.left_side_landmarks),
                "right_invisible": right_side_invisible_count,
                "right_total": len(self.right_side_landmarks),
                "left_gone": left_side_gone,
                "right_gone": right_side_gone,
                "should_stop": should_stop
            }
            
            return should_stop

        except Exception as e:
            return True  # Stop on error

    def detect_back_view(self, landmarks):
        """
        Detect if the person is facing away (back view) based on landmark visibility patterns.
        Uses MediaPipe pose landmarks to determine front vs back view with high accuracy.
        """
        try:
            if not landmarks:
                return {"is_back_view": False, "confidence": 0.0, "reason": "no_landmarks"}

            # Front-facing landmarks (face/front body features)
            front_landmarks = [
                self.mp_pose.PoseLandmark.NOSE,
                self.mp_pose.PoseLandmark.LEFT_EYE,
                self.mp_pose.PoseLandmark.RIGHT_EYE,
                self.mp_pose.PoseLandmark.LEFT_EYE_INNER,
                self.mp_pose.PoseLandmark.RIGHT_EYE_INNER,
                self.mp_pose.PoseLandmark.LEFT_EYE_OUTER,
                self.mp_pose.PoseLandmark.RIGHT_EYE_OUTER,
                self.mp_pose.PoseLandmark.LEFT_EAR,
                self.mp_pose.PoseLandmark.RIGHT_EAR,
                self.mp_pose.PoseLandmark.MOUTH_LEFT,
                self.mp_pose.PoseLandmark.MOUTH_RIGHT
            ]

            # Back-facing landmarks (shoulders, hips, back structure)
            back_landmarks = [
                self.mp_pose.PoseLandmark.LEFT_SHOULDER,
                self.mp_pose.PoseLandmark.RIGHT_SHOULDER,
                self.mp_pose.PoseLandmark.LEFT_HIP,
                self.mp_pose.PoseLandmark.RIGHT_HIP
            ]

            # Calculate average visibility for front landmarks
            front_visibility_sum = 0
            front_count = 0
            for landmark_idx in front_landmarks:
                landmark = landmarks.landmark[landmark_idx.value]
                front_visibility_sum += landmark.visibility
                front_count += 1

            front_avg_visibility = front_visibility_sum / front_count if front_count > 0 else 0

            # Calculate average visibility for back landmarks
            back_visibility_sum = 0
            back_count = 0
            for landmark_idx in back_landmarks:
                landmark = landmarks.landmark[landmark_idx.value]
                back_visibility_sum += landmark.visibility
                back_count += 1

            back_avg_visibility = back_visibility_sum / back_count if back_count > 0 else 0

            # Calculate back view confidence
            # High back view confidence = low front visibility + high back visibility
            front_invisible_score = 1.0 - front_avg_visibility  # Higher when front is not visible
            back_visible_score = back_avg_visibility             # Higher when back structure is visible

            # Weighted combination (front invisibility is more important indicator)
            back_confidence = (front_invisible_score * 0.7) + (back_visible_score * 0.3)

            # Determine if it's a back view (threshold at 0.6)
            is_back_view = back_confidence > 0.6

            # Generate reason for decision
            reason = f"front_vis:{front_avg_visibility:.2f}_back_vis:{back_avg_visibility:.2f}"

            return {
                "is_back_view": is_back_view,
                "confidence": back_confidence,
                "front_visibility": front_avg_visibility,
                "back_visibility": back_avg_visibility,
                "reason": reason
            }

        except Exception as e:
            return {"is_back_view": False, "confidence": 0.0, "reason": f"error:{str(e)}"}
    
    def get_body_bbox(self, landmarks, image_shape):
        """
        Calculate bounding box for detected body
        """
        try:
            if not landmarks:
                return None
                
            x_coords = []
            y_coords = []
            
            for landmark in landmarks.landmark:
                if landmark.visibility > 0.5:  # Only include visible landmarks
                    x_coords.append(landmark.x)
                    y_coords.append(landmark.y)
            
            if not x_coords or not y_coords:
                return None
                
            # Calculate normalized bounding box
            bbox = {
                "x1": min(x_coords),
                "y1": min(y_coords),
                "x2": max(x_coords),
                "y2": max(y_coords)
            }
            
            return bbox
            
        except Exception as e:
            return None
    
    def process_frame(self, image_data, format='base64', crop_info=None):
        """
        Process a single frame and detect pose
        
        Args:
            image_data: Image data (base64 string or numpy array)
            format: 'base64' or 'numpy'
            crop_info: Optional crop information for display mode
            
        Returns:
            dict with pose detection results
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
            
            # Store original dimensions
            original_height, original_width = image.shape[:2]
            
            # Apply crop if specified
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
                
                # Crop the image
                image = image[y1:y2, x1:x2]
            
            # Convert BGR to RGB (MediaPipe uses RGB)
            rgb_image = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            
            # Process the image
            results = self.pose.process(rgb_image)
            
            # Extract pose information
            pose_info = {
                "detected": False,
                "full_body_visible": False,
                "confidence": 0,
                "bbox": None,
                "landmarks": []
            }
            
            if results.pose_landmarks:
                # Check if full body is visible
                is_full_body, confidence = self.check_full_body_visible(results.pose_landmarks)
                
                # Check stop condition
                should_stop = self.check_stop_condition(results.pose_landmarks)

                # Check back view
                back_view_result = self.detect_back_view(results.pose_landmarks)

                # Get bounding box
                bbox = self.get_body_bbox(results.pose_landmarks, image.shape)
                
                # Extract all landmarks
                landmarks = []
                for landmark in results.pose_landmarks.landmark:
                    landmarks.append({
                        "x": landmark.x,
                        "y": landmark.y,
                        "z": landmark.z,
                        "visibility": landmark.visibility
                    })
                
                pose_info = {
                    "detected": True,
                    "full_body_visible": is_full_body,
                    "should_stop_recording": should_stop,
                    "confidence": confidence,
                    "bbox": bbox,
                    "landmarks": landmarks,
                    "back_view": back_view_result,
                    "stop_debug": getattr(self, 'stop_debug_info', None)  # Include debug info
                }
            
            return {
                "success": True,
                "pose": pose_info,
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
    Expected input: Binary protocol with header
    """
    detector = PoseDetector()

    try:
        while True:
            # Read header length (4 bytes)
            header_length_bytes = sys.stdin.buffer.read(4)
            if not header_length_bytes or len(header_length_bytes) < 4:
                break

            # Parse header length
            header_length = int.from_bytes(header_length_bytes, 'little')

            # Read header
            header_bytes = sys.stdin.buffer.read(header_length)
            if not header_bytes or len(header_bytes) < header_length:
                break

            # Parse header JSON
            try:
                header = json.loads(header_bytes.decode('utf-8'))
            except json.JSONDecodeError as e:
                print(json.dumps({"error": f"Invalid header JSON: {str(e)}"}), flush=True)
                continue
                
            if header.get("type") == "process_frame":
                if header.get("format") == "binary":
                    # Read binary image data
                    data_length = header.get("data_length", 0)
                    image_bytes = sys.stdin.buffer.read(data_length)
                    
                    if len(image_bytes) < data_length:
                        print(json.dumps({"error": "Incomplete image data"}), flush=True)
                        continue
                    
                    # Process binary data directly
                    crop_info = header.get("crop_info", None)
                    
                    # Convert bytes to numpy array
                    np_array = np.frombuffer(image_bytes, np.uint8)
                    if np_array.size == 0:
                        print(json.dumps({"error": "Empty image data"}), flush=True)
                        continue
                    
                    # Decode image
                    image = cv2.imdecode(np_array, cv2.IMREAD_COLOR)
                    if image is None:
                        print(json.dumps({"error": "Failed to decode image"}), flush=True)
                        continue
                    
                    # Process frame
                    result = detector.process_frame(image, format='numpy', crop_info=crop_info)
                    
                    # Output result
                    print(json.dumps(result), flush=True)
                    
            elif header.get("type") == "ping":
                # Health check
                print(json.dumps({"success": True, "message": "pong"}), flush=True)
                
            elif header.get("type") == "config":
                # Update configuration
                new_config = header.get("config", {})
                detector = PoseDetector(new_config)
                print(json.dumps({"success": True, "message": "config updated"}), flush=True)
                
            else:
                print(json.dumps({"error": f"Unknown command type: {header.get('type')}"}), flush=True)
                
    except KeyboardInterrupt:
        pass
    except Exception as e:
        print(json.dumps({"error": f"Fatal error: {str(e)}"}), flush=True)
        sys.exit(1)

if __name__ == "__main__":
    main()