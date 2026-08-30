"""YOLO26 model selection and inference device helpers."""
import os

try:
    import torch
except Exception:  # pragma: no cover - torch is required at runtime
    torch = None

MODEL_FAMILY = "YOLO26"
DEFAULT_PREVIEW = os.getenv("MODEL_PREVIEW", "yolo26s")
DEFAULT_PUBLISH = os.getenv("MODEL_PUBLISH", "yolo26m")
PERSON_CLASS_ID = 0
BALL_CLASS_ID = 32
SOCCER_CLASSES = [PERSON_CLASS_ID, BALL_CLASS_ID]


def get_model_name(mode: str = "preview") -> str:
    if str(mode).lower() == "publish":
        return os.getenv("MODEL_PUBLISH", DEFAULT_PUBLISH)
    return os.getenv("MODEL_PREVIEW", DEFAULT_PREVIEW)


def weights_path(model_name: str) -> str:
    if model_name.endswith(".pt"):
        return model_name
    return f"{model_name}.pt"


def get_device() -> str:
    if torch is None:
        return "cpu"
    if torch.cuda.is_available():
        return "cuda"
    mps = getattr(torch.backends, "mps", None)
    if mps is not None and mps.is_available():
        return "mps"
    return "cpu"


def use_half_precision(device: str) -> bool:
    return device == "cuda"
