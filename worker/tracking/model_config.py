"""YOLO26 model selection and inference device helpers."""
import os

try:
    import torch
except Exception:  # pragma: no cover - torch is required at runtime
    torch = None

MODEL_FAMILY = "YOLO26"
DEFAULT_PREVIEW = os.getenv("MODEL_PREVIEW", "yolo26n")
DEFAULT_PUBLISH = os.getenv("MODEL_PUBLISH", "yolo26s")
PERSON_CLASS_ID = 0
BALL_CLASS_ID = 32
SOCCER_CLASSES = [PERSON_CLASS_ID, BALL_CLASS_ID]


def get_model_name(mode: str = "preview") -> str:
    if str(mode).lower() == "publish":
        return os.getenv("MODEL_PUBLISH", DEFAULT_PUBLISH)
    return os.getenv("MODEL_PREVIEW", DEFAULT_PREVIEW)


def weights_path(model_name: str) -> str:
    if model_name.endswith(".pt"):
        candidate = model_name
    else:
        candidate = f"{model_name}.pt"
    if os.path.isfile(candidate):
        return candidate
    fallback = os.getenv("MODEL_FALLBACK", "yolo26s.pt")
    if candidate != fallback and os.path.isfile(fallback):
        print(f"{candidate} not found locally; using {fallback}")
        return fallback
    return candidate


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


def get_frame_stride(mode: str = "preview") -> int:
    if str(mode).lower() == "publish":
        return int(os.getenv("FRAME_STRIDE_PUBLISH", "2"))
    return int(os.getenv("FRAME_STRIDE_PREVIEW", "5"))


def get_image_size(mode: str = "preview") -> int:
    if str(mode).lower() == "publish":
        return int(os.getenv("IMG_SIZE_PUBLISH", "640"))
    return int(os.getenv("IMG_SIZE_PREVIEW", "416"))
