"""Domain exceptions for CRUD/business-logic operations.

Routers translate these into appropriate HTTP responses.
"""

from __future__ import annotations


class DomainError(Exception):
    """Base class for domain/business-rule violations.

    ``status_code`` is the HTTP status a router should use when translating
    this error into a response.
    """

    status_code: int = 400

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message


class NotFoundError(DomainError):
    """A referenced resource does not exist."""

    status_code = 404


class ConflictError(DomainError):
    """The request conflicts with the current state (e.g. capacity, in-use)."""

    status_code = 409


class ValidationError(DomainError):
    """The request is semantically invalid (e.g. temperature mismatch)."""

    status_code = 422
