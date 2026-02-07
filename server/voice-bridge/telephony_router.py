"""
Telephony Router
Routes calls to appropriate provider (Twilio/Exotel) based on configuration
"""

from typing import Dict, Any, Optional
from enum import Enum
from loguru import logger

from adapters.twilio_adapter import TwilioAdapter
from adapters.exotel_adapter import ExotelAdapter


class TelephonyProvider(str, Enum):
    """Supported telephony providers"""
    TWILIO = "twilio"
    EXOTEL = "exotel"


class TelephonyRouter:
    """
    Routes calls to appropriate telephony provider.
    
    Supports:
    - Twilio: Global coverage, native Vocode integration
    - Exotel: India-focused, cost optimized (30-40% cheaper)
    
    Provider selection:
    - Per-business configuration
    - Region-based routing
    - Fallback support
    """
    
    # Default provider by region
    REGION_DEFAULTS = {
        "IN": TelephonyProvider.EXOTEL,  # India → Exotel (cheaper)
        "US": TelephonyProvider.TWILIO,
        "EU": TelephonyProvider.TWILIO,
        "GB": TelephonyProvider.TWILIO,
        "default": TelephonyProvider.TWILIO,
    }
    
    def __init__(self, node_api_client):
        self.node_api_client = node_api_client
        
        # Initialize adapters
        self.twilio_adapter = TwilioAdapter(node_api_client)
        self.exotel_adapter = ExotelAdapter(node_api_client)
        
        # Active calls tracking
        self.active_calls: Dict[str, Dict[str, Any]] = {}
        
        logger.info("📞 TelephonyRouter initialized with Twilio + Exotel support")
    
    def get_adapter(self, provider: TelephonyProvider):
        """Get the appropriate adapter for the provider"""
        if provider == TelephonyProvider.TWILIO:
            return self.twilio_adapter
        elif provider == TelephonyProvider.EXOTEL:
            return self.exotel_adapter
        else:
            # Default to Twilio
            return self.twilio_adapter
    
    def detect_region_from_number(self, phone_number: str) -> str:
        """Detect region from phone number country code"""
        if not phone_number:
            return "default"
        
        # Clean the number
        number = phone_number.replace(" ", "").replace("-", "")
        
        # Detect by country code
        if number.startswith("+91") or number.startswith("91"):
            return "IN"
        elif number.startswith("+1"):
            return "US"
        elif number.startswith("+44"):
            return "GB"
        elif number.startswith("+49") or number.startswith("+33") or number.startswith("+39"):
            return "EU"
        else:
            return "default"
    
    async def get_provider_for_call(
        self, 
        phone_number: str,
        business_id: Optional[str] = None
    ) -> TelephonyProvider:
        """
        Determine which provider to use for a call.
        
        Priority:
        1. Business-specific configuration
        2. Region-based default
        """
        # Check business configuration if available
        if business_id:
            try:
                business_config = await self.node_api_client.get_business_config(phone_number)
                configured_provider = business_config.get("voiceProvider")
                
                if configured_provider:
                    return TelephonyProvider(configured_provider)
            except Exception as e:
                logger.warning(f"Failed to get business config: {e}")
        
        # Fall back to region-based routing
        region = self.detect_region_from_number(phone_number)
        return self.REGION_DEFAULTS.get(region, self.REGION_DEFAULTS["default"])
    
    async def handle_inbound_call(
        self,
        call_sid: str,
        from_number: str,
        to_number: str,
        provider: TelephonyProvider,
        websocket=None
    ) -> Dict[str, Any]:
        """
        Route inbound call to appropriate provider.
        """
        logger.info(f"📞 Routing call {call_sid} to {provider.value}")
        
        adapter = self.get_adapter(provider)
        
        # Track call
        self.active_calls[call_sid] = {
            "provider": provider,
            "from_number": from_number,
            "to_number": to_number,
        }
        
        # Handle based on provider
        if provider == TelephonyProvider.EXOTEL:
            result = await adapter.handle_inbound_call(
                call_sid, from_number, to_number, websocket
            )
        else:
            result = await adapter.handle_inbound_call(
                call_sid, from_number, to_number
            )
        
        return result
    
    async def handle_call_end(self, call_sid: str, duration: int):
        """Route call end to appropriate provider"""
        if call_sid not in self.active_calls:
            return
        
        call_data = self.active_calls[call_sid]
        provider = call_data["provider"]
        adapter = self.get_adapter(provider)
        
        await adapter.handle_call_end(call_sid, duration)
        
        # Cleanup
        del self.active_calls[call_sid]
    
    def get_all_routes(self):
        """Get combined webhook routes for all providers"""
        from fastapi import APIRouter
        
        router = APIRouter()
        
        # Include Twilio routes
        router.include_router(self.twilio_adapter.get_webhook_routes())
        
        # Include Exotel routes
        router.include_router(self.exotel_adapter.get_webhook_routes())
        
        return router
    
    def get_stats(self) -> Dict[str, Any]:
        """Get telephony stats"""
        return {
            "active_calls": len(self.active_calls),
            "calls_by_provider": {
                "twilio": len([c for c in self.active_calls.values() if c["provider"] == TelephonyProvider.TWILIO]),
                "exotel": len([c for c in self.active_calls.values() if c["provider"] == TelephonyProvider.EXOTEL]),
            },
            "active_twilio_calls": len(self.twilio_adapter.active_calls),
            "active_exotel_calls": len(self.exotel_adapter.active_calls),
        }
