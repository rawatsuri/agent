"""
Voice Bridge Adapters
Multi-provider telephony support (Twilio global, Exotel India)
"""

from .twilio_adapter import TwilioAdapter
from .exotel_adapter import ExotelAdapter

__all__ = ["TwilioAdapter", "ExotelAdapter"]
