"""Optional footprint schema validation for the report CLI."""

from __future__ import annotations

import json
from collections.abc import Mapping
from dataclasses import dataclass
from importlib import resources
from typing import Any


@dataclass(frozen=True)
class SchemaValidationIssue:
    message: str
    is_failure: bool
    pointer: str = "/"


def validate_footprint_v01(footprint: Mapping[str, Any]) -> tuple[SchemaValidationIssue, ...]:
    """Validate a footprint against the packaged footprint schema."""

    try:
        from jsonschema import Draft202012Validator, FormatChecker
    except ImportError:
        return (
            SchemaValidationIssue(
                message="Schema validation could not run because jsonschema is not installed.",
                is_failure=True,
            ),
        )

    try:
        schema = _load_packaged_schema()
    except FileNotFoundError:
        return (
            SchemaValidationIssue(
                message="Schema validation could not run because the packaged footprint schema was not found.",
                is_failure=True,
            ),
        )
    except json.JSONDecodeError:
        return (
            SchemaValidationIssue(
                message="Schema validation could not run because the packaged footprint schema is invalid JSON.",
                is_failure=True,
            ),
        )

    validator = Draft202012Validator(schema, format_checker=FormatChecker())
    errors = sorted(validator.iter_errors(footprint), key=lambda error: list(error.path))
    return tuple(_issue_from_error(error) for error in errors)


def _load_packaged_schema() -> Mapping[str, Any]:
    schema_text = (
        resources.files("honua_esri_assess")
        .joinpath("schemas", "esri-footprint-v0.3.json")
        .read_text(encoding="utf-8")
    )
    schema = json.loads(schema_text)
    if not isinstance(schema, Mapping):
        raise json.JSONDecodeError("schema root is not an object", schema_text, 0)
    return schema


def _issue_from_error(error: Any) -> SchemaValidationIssue:
    pointer = "/" + "/".join(str(part) for part in error.path)
    if pointer == "/":
        pointer = "/"
    message = f"Schema validation failed at {pointer}: {_sanitized_reason(error)}."
    return SchemaValidationIssue(message=message, is_failure=True, pointer=pointer)


def _sanitized_reason(error: Any) -> str:
    validator = getattr(error, "validator", None)
    return {
        "additionalProperties": "field is not allowed by the footprint schema",
        "anyOf": "field does not match any allowed schema shape",
        "const": "field does not match the required schema value",
        "enum": "field is not in the allowed schema vocabulary",
        "format": "field does not match the required format",
        "oneOf": "field does not match exactly one allowed schema shape",
        "pattern": "field does not match the required prospect-safe format",
        "required": "required field is missing",
        "type": "field has the wrong JSON type",
    }.get(str(validator), f"schema rule `{validator}` failed")
