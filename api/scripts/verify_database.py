import logging

from sqlalchemy import create_engine, text
from sqlalchemy.exc import SQLAlchemyError

from app.core.config import get_settings

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def verify_database_access() -> None:
    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)

    try:
        with engine.connect() as connection:
            with connection.begin():
                connection.execute(text("SET TRANSACTION READ ONLY"))

                dog_count = connection.execute(
                    text(
                        """
                        SELECT COUNT(*) 
                        FROM dog_features as features
                        JOIN dog_profiles as profiles
                        ON profiles.id = features.dog_profile_id
                        """
                    )
                ).scalar_one()

                logger.info(f"Successfully connected to the database. Dog count: {dog_count}")
    except SQLAlchemyError as e:
        logger.error(f"Database access verification failed: {e}")
        raise
    finally:
        engine.dispose()

if __name__ == "__main__":
    verify_database_access()
  

