from fastapi import APIRouter

router = APIRouter(tags=["health"])

@router.get("/health", summary="Health check endpoint")
def get_health():
    """
    Health check endpoint to verify that the API is running.
    Returns a simple JSON response indicating the status of the API.
    """
    return {"status": "ok"}