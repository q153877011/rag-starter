"""POST /history - Retrieve conversation history.

Returns filtered messages for frontend to restore chat after refresh.
"""

from typing import Any

from .._logger import create_logger

logger = create_logger("history")


def _content_to_text(content) -> str:
    """Extract text from various content formats."""
    if isinstance(content, str):
        return content
    if isinstance(content, dict):
        if "content" in content:
            return _content_to_text(content["content"])
        if "output" in content:
            return _content_to_text(content["output"])
        if "text" in content:
            return str(content.get("text", ""))
        return ""
    if isinstance(content, list):
        parts = []
        for item in content:
            if isinstance(item, dict):
                text = str(item.get("text", "") or item.get("output_text", "") or "")
                if text:
                    parts.append(text)
        return "\n".join(parts)
    return str(content) if content else ""


async def handler(context: Any):
    """Return conversation history for frontend restoration."""
    conversation_id = getattr(context, "conversation_id", "")
    store = getattr(context, "store", None)

    if not store or not conversation_id:
        logger.log("No store or conversationId, returning empty")
        return {"messages": []}

    try:
        # Attempt to get messages from store
        if not hasattr(store, "get_messages"):
            return {"messages": []}

        history = await store.get_messages(conversation_id)

        logger.log(f"Fetched {len(history)} raw messages for conversation: {conversation_id}")

        messages = []
        groups: dict[str, dict] = {}
        group_order = 0

        for item in history:
            role = item.get("role")
            if role not in ("user", "assistant"):
                continue

            # Filter SDK internal items
            meta = item.get("metadata", {}) or {}
            if meta.get("agent_sdk_session"):
                item_type = meta.get("item_type")
                if item_type is not None and item_type != "message":
                    continue

            content = _content_to_text(item.get("content"))
            if not content:
                continue

            msg = {
                "id": item.get("messageId", f"{role}-{item.get('createdAt', 0)}"),
                "role": role,
                "content": content,
                "timestamp": item.get("createdAt", 0),
            }

            run_id = meta.get("run_id")
            if not run_id:
                messages.append(msg)
                continue

            if run_id not in groups:
                groups[run_id] = {"user": None, "assistant": None, "order": group_order}
                group_order += 1

            group = groups[run_id]
            if role == "user" and group["user"] is None:
                group["user"] = msg
            elif role == "assistant":
                group["assistant"] = msg

        # Flatten groups in order
        sorted_groups = sorted(groups.values(), key=lambda g: g["order"])
        for group in sorted_groups:
            if group["user"]:
                messages.append(group["user"])
            if group["assistant"]:
                messages.append(group["assistant"])

        logger.log(f"Returning {len(messages)} filtered messages")
        return {"conversation_id": conversation_id, "messages": messages}

    except Exception as e:
        logger.error(f"History fetch error: {e}")
        return {"messages": [], "error": str(e)}
