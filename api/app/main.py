from fastapi import FastAPI

from app.api.routes.health import router as health_router

def create_app() -> FastAPI:
    app = FastAPI(title="Pet Connect API")
    app.include_router(health_router)
    return app

app = create_app()