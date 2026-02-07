"""
Node.js API Client
Communicates with the Node.js backend for AI responses and data
"""

import asyncio
from typing import Any, Optional

import httpx
from loguru import logger

from config import settings


class NodeAPIClient:
    """Client for communicating with Node.js backend API"""

    def __init__(self):
        self.base_url = settings.NODE_API_URL
        self.api_key = settings.NODE_API_KEY
        self.timeout = settings.NODE_API_TIMEOUT
        self.retry_attempts = settings.NODE_API_RETRY_ATTEMPTS

        # Headers for all requests
        self.headers = {
            "Content-Type": "application/json",
            "User-Agent": "VoiceBridge/1.0",
        }

        if self.api_key:
            self.headers["X-API-Key"] = self.api_key

    async def _request(
        self,
        method: str,
        endpoint: str,
        data: Optional[dict] = None,
        params: Optional[dict] = None,
    ) -> Optional[dict]:
        """
        Make HTTP request with retries

        Args:
            method: HTTP method
            endpoint: API endpoint (without base URL)
            data: Request body
            params: Query parameters

        Returns:
            Response data or None on error
        """
        url = f"{self.base_url}{endpoint}"

        for attempt in range(self.retry_attempts):
            try:
                async with httpx.AsyncClient(timeout=self.timeout) as client:
                    if method == "GET":
                        response = await client.get(
                            url, headers=self.headers, params=params
                        )
                    elif method == "POST":
                        response = await client.post(
                            url, headers=self.headers, json=data
                        )
                    elif method == "PUT":
                        response = await client.put(
                            url, headers=self.headers, json=data
                        )
                    else:
                        raise ValueError(f"Unsupported method: {method}")

                    if response.status_code == 200:
                        return response.json()
                    elif response.status_code == 429:
                        # Rate limited - backoff and retry
                        wait_time = 2**attempt
                        logger.warning(
                            f"Rate limited, waiting {wait_time}s before retry"
                        )
                        await asyncio.sleep(wait_time)
                    else:
                        logger.error(
                            f"API error: {response.status_code} - {response.text}"
                        )
                        if attempt < self.retry_attempts - 1:
                            await asyncio.sleep(1)

            except httpx.TimeoutException:
                logger.error(
                    f"Request timeout (attempt {attempt + 1}/{self.retry_attempts})"
                )
                if attempt < self.retry_attempts - 1:
                    await asyncio.sleep(1)

            except Exception as e:
                logger.error(f"Request error: {e}")
                if attempt < self.retry_attempts - 1:
                    await asyncio.sleep(1)

        return None

    async def health_check(self) -> dict:
        """
        Check Node.js API health

        Returns:
            Health status dict
        """
        try:
            # Try root endpoint first (doesn't require auth)
            result = await self._request("GET", "/")
            if result and result.get("status") == "running":
                return {"status": "ok", "service": result.get("service", "unknown")}

            # Fallback to /health if root doesn't work
            result = await self._request("GET", "/health")
            return result or {"status": "unknown"}
        except Exception as e:
            logger.error(f"Health check failed: {e}")
            return {"status": "error", "error": str(e)}

    async def process_voice_message(
        self,
        call_sid: str,
        phone_number: str,
        transcribed_text: str,
        conversation_context: Optional[dict] = None,
    ) -> Optional[dict]:
        """
        Send transcribed voice message to AI and get response

        Args:
            call_sid: Call identifier
            phone_number: Customer phone number
            transcribed_text: Speech-to-text result
            conversation_context: Optional context (business ID, customer ID, etc.)

        Returns:
            AI response dict with text and metadata
        """
        data = {
            "channel": "voice",
            "callSid": call_sid,
            "phoneNumber": phone_number,
            "message": transcribed_text,
            "context": conversation_context or {},
        }

        result = await self._request("POST", "/api/agent/voice", data=data)

        if result:
            logger.info(f"✅ AI response received for call {call_sid}")
            return result
        else:
            logger.error(f"Failed to get AI response for call {call_sid}")
            return None

    async def check_voice_budget(
        self, phone_number: str, call_duration_estimate: int = 300
    ) -> dict:
        """
        Check if call is allowed based on budget and rate limits

        Args:
            phone_number: Customer phone number
            call_duration_estimate: Estimated call duration in seconds

        Returns:
            Budget check result
        """
        data = {
            "channel": "voice",
            "phoneNumber": phone_number,
            "estimatedDuration": call_duration_estimate,
        }

        result = await self._request("POST", "/api/agent/check-budget", data=data)

        if result:
            return result

        # Default to allowed if API fails (fail open for better UX)
        return {"allowed": True}

    async def create_voice_conversation(
        self,
        call_sid: str,
        phone_number: str,
        business_id: str = None,
        customer_id: str = None,
    ) -> dict:
        """
        Create a conversation record for a voice call.
        Must be called at call start to enable transcript saving later.

        Args:
            call_sid: Call identifier from Twilio/Exotel
            phone_number: Customer phone number
            business_id: Optional business ID
            customer_id: Optional customer ID

        Returns:
            Dict with conversationId
        """
        data = {
            "callSid": call_sid,
            "phoneNumber": phone_number,
            "businessId": business_id,
            "customerId": customer_id,
        }

        result = await self._request(
            "POST", "/api/agent/create-conversation", data=data
        )

        if result:
            logger.info(f"✅ Conversation created for call {call_sid}")
            return result
        else:
            logger.warning(f"Failed to create conversation for call {call_sid}")
            return {"conversationId": None}

    async def report_call_cost(
        self,
        call_sid: str,
        duration_seconds: int,
        phone_number: Optional[str] = None,
        provider: str = None,
    ) -> bool:
        """
        Report call cost to Node.js API for tracking

        Args:
            call_sid: Call identifier
            duration_seconds: Call duration
            phone_number: Customer phone number
            provider: Voice provider (twilio/exotel)

        Returns:
            True if successful
        """
        data = {
            "callSid": call_sid,
            "durationSeconds": duration_seconds,
            "phoneNumber": phone_number,
            "provider": provider,
        }

        result = await self._request("POST", "/api/agent/report-call-cost", data=data)

        if result:
            cost = result.get("cost", 0)
            logger.info(f"✅ Call cost logged: ${cost:.4f} for {duration_seconds}s")
            return True
        else:
            logger.error("Failed to log call cost")
            return False

    async def save_recording(self, call_sid: str, recording_url: str) -> bool:
        """
        Save call recording reference

        Args:
            call_sid: Call identifier
            recording_url: Recording URL

        Returns:
            True if successful
        """
        data = {"callSid": call_sid, "recordingUrl": recording_url, "channel": "voice"}

        result = await self._request("POST", "/api/agent/save-recording", data=data)

        return result is not None

    async def get_customer_context(self, phone_number: str) -> Optional[dict]:
        """
        Get customer context from Node.js API

        Args:
            phone_number: Customer phone number

        Returns:
            Customer data or None
        """
        params = {"phoneNumber": phone_number}

        result = await self._request("GET", "/api/agent/customer", params=params)

        return result

    async def log_conversation_event(
        self, call_sid: str, event_type: str, event_data: dict
    ) -> bool:
        """
        Log conversation event (transcription, response, transfer, etc.)

        Args:
            call_sid: Call identifier
            event_type: Type of event
            event_data: Event details

        Returns:
            True if successful
        """
        data = {
            "callSid": call_sid,
            "channel": "voice",
            "eventType": event_type,
            "eventData": event_data,
            "timestamp": asyncio.get_event_loop().time(),
        }

        result = await self._request("POST", "/api/agent/log-event", data=data)

        return result is not None

    async def request_human_transfer(
        self, call_sid: str, phone_number: str, reason: str
    ) -> Optional[dict]:
        """
        Request to transfer call to human agent

        Args:
            call_sid: Call identifier
            phone_number: Customer phone number
            reason: Reason for transfer

        Returns:
            Transfer instructions or None
        """
        data = {
            "callSid": call_sid,
            "phoneNumber": phone_number,
            "reason": reason,
            "channel": "voice",
        }

        result = await self._request("POST", "/api/agent/request-transfer", data=data)

        return result

    async def get_business_config(self, phone_number: str) -> Optional[dict]:
        """
        Get business configuration for a phone number

        Args:
            phone_number: The Exotel number that was called

        Returns:
            Business configuration dict
        """
        params = {"phoneNumber": phone_number}

        result = await self._request("GET", "/api/agent/business-config", params=params)

        if not result:
            # Return default config
            return {
                "welcomeMessage": "Hello! How can I help you today?",
                "aiPersonality": "professional and helpful",
                "maxCallDuration": 600,
                "enableTransfer": True,
                "transferNumber": None,
            }

        return result

    async def get_full_context(self, phone_number: str) -> dict:
        """
        Get full context for a voice call (customer + memories + business).
        Called ONCE at call start for low-latency conversations.

        Args:
            phone_number: Customer phone number

        Returns:
            Full context dict with customer, memories, business, etc.
        """
        params = {"phoneNumber": phone_number}

        result = await self._request("GET", "/api/agent/full-context", params=params)

        if result:
            logger.info(f"✅ Full context loaded for {phone_number}")
            return result

        # Return minimal default context
        logger.warning(f"Failed to load context for {phone_number}, using defaults")
        return {
            "customer": {"name": "Customer", "trustScore": 50},
            "business": {"name": "Business"},
            "memories": [],
            "recentConversations": [],
            "welcomeMessage": "Hello! How can I help you today?",
            "voiceId": "en-US-JennyNeural",
        }

    async def save_transcript(self, call_sid: str, transcript: list) -> bool:
        """
        Save full call transcript to database.

        Args:
            call_sid: Call identifier
            transcript: List of transcript entries

        Returns:
            True if successful
        """
        data = {"callSid": call_sid, "channel": "voice", "transcript": transcript}

        result = await self._request("POST", "/api/agent/save-transcript", data=data)

        if result:
            logger.info(f"✅ Transcript saved for call {call_sid}")
            return True
        else:
            logger.error(f"Failed to save transcript for call {call_sid}")
            return False
