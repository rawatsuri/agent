"""
Exotel Handler - Telephony Integration
Handles incoming calls, call status, recordings, and transfers
"""

import base64
from typing import Optional

import httpx
from loguru import logger

from config import settings


class ExotelHandler:
    """Handle Exotel telephony operations"""
    
    def __init__(self):
        self.base_url = settings.exotel_base_url
        self.auth = settings.exotel_auth
        self.enabled = all([settings.EXOTEL_SID, settings.EXOTEL_API_KEY, settings.EXOTEL_API_TOKEN])
        
        if not self.enabled:
            logger.warning("⚠️  Exotel not fully configured. Some features will be disabled.")
    
    def get_stream_twiml(self, call_sid: str, websocket_url: str) -> str:
        """
        Generate TwiML to connect call to streaming WebSocket
        
        Args:
            call_sid: Unique call identifier
            websocket_url: WebSocket URL for streaming
            
        Returns:
            TwiML XML string
        """
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="woman" language="en-US">Connecting you to our AI assistant. Please speak after the beep.</Say>
    <Pause length="1"/>
    <Connect>
        <Stream url="{websocket_url}" track="both_tracks">
            <Parameter name="call_sid" value="{call_sid}"/>
        </Stream>
    </Connect>
</Response>"""
        return twiml
    
    def get_reject_twiml(self, message: str = "Service unavailable.") -> str:
        """
        Generate TwiML to reject a call with a message
        
        Args:
            message: Message to play before hanging up
            
        Returns:
            TwiML XML string
        """
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="woman" language="en-US">{message}</Say>
    <Hangup/>
</Response>"""
        return twiml
    
    def get_error_twiml(self) -> str:
        """
        Generate TwiML for error response
        
        Returns:
            TwiML XML string
        """
        return """<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="woman" language="en-US">Sorry, we are experiencing technical difficulties. Please try again later.</Say>
    <Hangup/>
</Response>"""
    
    def get_transfer_twiml(self, transfer_to: str, message: Optional[str] = None) -> str:
        """
        Generate TwiML to transfer call to another number
        
        Args:
            transfer_to: Number to transfer to
            message: Optional message before transfer
            
        Returns:
            TwiML XML string
        """
        msg = message or "Please hold while we transfer you to a representative."
        twiml = f"""<?xml version="1.0" encoding="UTF-8"?>
<Response>
    <Say voice="woman" language="en-US">{msg}</Say>
    <Dial>{transfer_to}</Dial>
</Response>"""
        return twiml
    
    async def hangup_call(self, call_sid: str) -> bool:
        """
        Hangup an active call via Exotel API
        
        Args:
            call_sid: Call identifier
            
        Returns:
            True if successful
        """
        if not self.enabled:
            logger.warning("Exotel not configured, cannot hangup call")
            return False
        
        try:
            url = f"{self.base_url}/Calls/{call_sid}.json"
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    auth=self.auth,
                    data={"Status": "completed"},
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    logger.info(f"✅ Successfully hung up call {call_sid}")
                    return True
                else:
                    logger.error(f"Failed to hangup call {call_sid}: {response.status_code} - {response.text}")
                    return False
                    
        except Exception as e:
            logger.error(f"Error hanging up call {call_sid}: {e}")
            return False
    
    async def transfer_call(self, call_sid: str, transfer_to: str) -> bool:
        """
        Transfer an active call to another number
        
        Args:
            call_sid: Call identifier
            transfer_to: Number to transfer to
            
        Returns:
            True if successful
        """
        if not self.enabled:
            logger.warning("Exotel not configured, cannot transfer call")
            return False
        
        try:
            # Exotel doesn't have a direct transfer API, we need to use TwiML
            # This would typically be done by updating the call with new TwiML
            url = f"{self.base_url}/Calls/{call_sid}.json"
            
            # Generate transfer TwiML
            twiml = self.get_transfer_twiml(transfer_to)
            
            async with httpx.AsyncClient() as client:
                response = await client.post(
                    url,
                    auth=self.auth,
                    data={
                        "Status": "in-progress",
                        "Url": f"data:application/xml;base64,{base64.b64encode(twiml.encode()).decode()}"
                    },
                    timeout=10.0
                )
                
                if response.status_code == 200:
                    logger.info(f"✅ Successfully transferred call {call_sid} to {transfer_to}")
                    return True
                else:
                    logger.error(f"Failed to transfer call {call_sid}: {response.status_code}")
                    return False
                    
        except Exception as e:
            logger.error(f"Error transferring call {call_sid}: {e}")
            return False
    
    async def get_call_details(self, call_sid: str) -> Optional[dict]:
        """
        Get call details from Exotel
        
        Args:
            call_sid: Call identifier
            
        Returns:
            Call details dict or None
        """
        if not self.enabled:
            return None
        
        try:
            url = f"{self.base_url}/Calls/{call_sid}.json"
            
            async with httpx.AsyncClient() as client:
                response = await client.get(url, auth=self.auth, timeout=10.0)
                
                if response.status_code == 200:
                    return response.json()
                else:
                    logger.error(f"Failed to get call details: {response.status_code}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error getting call details: {e}")
            return None
    
    async def make_outbound_call(self, to_number: str, from_number: str, 
                                  websocket_url: str, 
                                  callback_url: Optional[str] = None) -> Optional[str]:
        """
        Make an outbound call via Exotel
        
        Args:
            to_number: Number to call
            from_number: Exotel number to call from
            websocket_url: WebSocket URL for streaming
            callback_url: Optional callback URL for status updates
            
        Returns:
            Call SID if successful, None otherwise
        """
        if not self.enabled:
            logger.warning("Exotel not configured, cannot make outbound call")
            return None
        
        try:
            url = f"{self.base_url}/Calls/connect.json"
            
            # Generate TwiML
            call_sid = f"OUT{to_number.replace('+', '')}"
            twiml = self.get_stream_twiml(call_sid, websocket_url)
            
            data = {
                "From": from_number,
                "To": to_number,
                "CallerId": from_number,
                "Url": f"data:application/xml;base64,{base64.b64encode(twiml.encode()).decode()}",
                "Record": "true" if settings.ENABLE_RECORDING else "false",
            }
            
            if callback_url:
                data["StatusCallback"] = callback_url
                data["StatusCallbackEvents[0]"] = "terminal"
            
            async with httpx.AsyncClient() as client:
                response = await client.post(url, auth=self.auth, data=data, timeout=10.0)
                
                if response.status_code == 200:
                    result = response.json()
                    logger.info(f"✅ Outbound call initiated: {result.get('Call', {}).get('Sid')}")
                    return result.get("Call", {}).get("Sid")
                else:
                    logger.error(f"Failed to make outbound call: {response.status_code} - {response.text}")
                    return None
                    
        except Exception as e:
            logger.error(f"Error making outbound call: {e}")
            return None
    
    def validate_webhook_signature(self, signature: str, url: str, 
                                    post_data: dict, auth_token: str) -> bool:
        """
        Validate Exotel webhook signature
        
        Args:
            signature: X-Exotel-Signature header
            url: Webhook URL
            post_data: POST data
            auth_token: Exotel auth token
            
        Returns:
            True if signature is valid
        """
        try:
            import hmac
            import hashlib
            
            # Sort POST data alphabetically
            sorted_data = "&".join([f"{k}={v}" for k, v in sorted(post_data.items())])
            
            # Create string to hash
            string_to_hash = url + sorted_data
            
            # Calculate HMAC-SHA1
            expected_signature = base64.b64encode(
                hmac.new(
                    auth_token.encode(),
                    string_to_hash.encode(),
                    hashlib.sha1
                ).digest()
            ).decode()
            
            return hmac.compare_digest(signature, expected_signature)
            
        except Exception as e:
            logger.error(f"Error validating webhook signature: {e}")
            return False
