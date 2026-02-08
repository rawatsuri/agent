"""
Voice Bridge Adapters
Multi-provider telephony support:
- Exotel: India (cost optimized, Vocode streaming)
- Twilio: Global (Vocode native integration)

Both adapters use Vocode's streaming pipeline for low-latency voice calls.
"""

# Both adapters are imported directly - they both use Vocode
from .exotel_adapter import ExotelAdapter
from .twilio_adapter import TwilioAdapter

__all__ = ["ExotelAdapter", "TwilioAdapter"]
