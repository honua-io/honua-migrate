"""Resolve Click exception classes used by the unified command tree.

Typer can vendor Click, so argument errors may belong to a different hierarchy
than standalone Click. Resolve each class independently because Exit and
ClickException can be exported from different modules.
"""

from __future__ import annotations

import click


def _candidate_modules() -> list[object]:
    modules: list[object] = [click, click.exceptions]
    try:  # pragma: no cover - depends on the installed Typer
        from typer import _click as typer_click

        modules.append(typer_click)
        modules.append(typer_click.exceptions)
    except Exception:  # pragma: no cover - older Typer shares standalone Click
        pass
    try:  # pragma: no cover - depends on the installed Typer
        import typer.exceptions as typer_exceptions

        modules.append(typer_exceptions)
    except Exception:  # pragma: no cover - Typer is a hard dependency
        pass
    return modules


def exception_types(*names: str) -> tuple[type[BaseException], ...]:
    """Return every exception class matching ``names`` that is actually present.

    Names are resolved independently, so a class missing from one module does
    not suppress the ones that are there.
    """

    found: list[type[BaseException]] = []
    for module in _candidate_modules():
        for name in names:
            candidate = getattr(module, name, None)
            if (
                isinstance(candidate, type)
                and issubclass(candidate, BaseException)
                and candidate not in found
            ):
                found.append(candidate)
    return tuple(found)


#: Raised to request a specific process exit code without an error message.
EXIT_EXCEPTIONS: tuple[type[BaseException], ...] = exception_types("Exit")

#: Raised to report a usage or runtime error the CLI should print and exit on.
CLICK_EXCEPTIONS: tuple[type[BaseException], ...] = exception_types("ClickException")

__all__ = ["CLICK_EXCEPTIONS", "EXIT_EXCEPTIONS", "exception_types"]
