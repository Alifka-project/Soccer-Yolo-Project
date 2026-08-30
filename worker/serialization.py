"""Convert numpy / nested tracking objects into JSON-safe Python types."""
from datetime import datetime
from typing import Any

import numpy as np


def jsonable(value: Any) -> Any:
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple, set)):
        return [jsonable(item) for item in value]
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (np.floating, np.integer)):
        return value.item()
    if isinstance(value, np.bool_):
        return bool(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, bytes):
        return len(value)
    return value
