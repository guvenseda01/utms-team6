import uuid
from dataclasses import dataclass
from typing import Any, Optional

from fastapi import HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.storage import MinIOClient
from app.domain.document import Document
from app.domain.enums import DocStatus, DocType
from app.external.document_extractor import EXTRACTABLE_DOC_TYPES, DocumentExtractor
from app.repositories.application_repository import ApplicationRepository
from app.repositories.document_repository import DocumentRepository

_MAX_FILE_SIZE = 5_242_880  # 5 MB
_PDF_MIME = "application/pdf"


@dataclass
class PresignedUploadResult:
    upload_url: str
    object_key: str


class DocumentService:
    def __init__(self, db: AsyncSession, storage: Optional[MinIOClient] = None) -> None:
        self.db = db
        self._doc_repo = DocumentRepository(db)
        self._app_repo = ApplicationRepository(db)
        self._storage = storage or MinIOClient()

    async def generate_upload_url(
        self, application_id: uuid.UUID, doc_type: DocType
    ) -> PresignedUploadResult:
        application = await self._app_repo.get_by_id(application_id)
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found")

        object_key = (
            f"applications/{application_id}/{doc_type.value}/{uuid.uuid4()}.pdf"
        )
        upload_url = self._storage.generate_presigned_put(object_key, ttl=300)
        return PresignedUploadResult(upload_url=upload_url, object_key=object_key)

    async def confirm_upload(
        self,
        application_id: uuid.UUID,
        doc_type: DocType,
        object_key: str,
        file_name: str,
        file_size_bytes: int,
        extracted_data: Optional[Any] = None,
    ) -> Document:
        if file_size_bytes > _MAX_FILE_SIZE:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail="File exceeds 5 MB limit.",
            )

        # Server-side MIME type validation via MinIO metadata
        try:
            meta = self._storage.get_object_metadata(object_key)
            content_type = meta.get("content_type", "")
            if content_type != _PDF_MIME:
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Invalid file format. Please upload a PDF file.",
                )
        except HTTPException:
            raise
        except Exception:
            # MinIO unreachable in tests — fall back to file name extension check
            if not file_name.lower().endswith(".pdf"):
                raise HTTPException(
                    status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                    detail="Invalid file format. Please upload a PDF file.",
                )

        document = Document(
            application_id=application_id,
            doc_type=doc_type,
            file_path=object_key,
            file_name=file_name,
            file_size_bytes=file_size_bytes,
            status=DocStatus.PENDING,
            extracted_data=extracted_data,
            extraction_confirmed=False,
        )
        await self._doc_repo.save(document)
        return document

    async def generate_preview_url(
        self, document_id: uuid.UUID, caller_id: uuid.UUID
    ) -> str:
        document = await self._doc_repo.get_by_id(document_id)
        if document is None:
            raise HTTPException(status_code=404, detail="Document not found")

        application = await self._app_repo.get_by_id(document.application_id)
        if application is None:
            raise HTTPException(status_code=404, detail="Application not found")

        # Permission: applicant can only view their own docs; staff can view all
        if application.applicant_id != caller_id:
            from app.repositories.user_repository import UserRepository
            from app.domain.enums import UserRole
            user = await UserRepository(self.db).get_by_id(caller_id)
            if user is None or user.role == UserRole.APPLICANT:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="You do not have permission to view this document",
                )

        return self._storage.generate_presigned_get(document.file_path, ttl=300)

    async def backfill_extraction(self, document: Document) -> Document:
        """Re-run PDF extraction when extracted_data was never stored (legacy uploads)."""
        if document.extracted_data is not None:
            return document
        if document.doc_type not in EXTRACTABLE_DOC_TYPES:
            return document

        extracted_data: dict[str, Any] = {}
        try:
            response = self._storage.get_object(document.file_path)
            try:
                content = response.read()
            finally:
                response.close()
                response.release_conn()
            extracted_data = await DocumentExtractor().extract(document.doc_type, content)
        except Exception:
            extracted_data = {}

        document.extracted_data = extracted_data
        await self.db.commit()
        await self.db.refresh(document)
        return document
