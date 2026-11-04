#!/usr/bin/env python3
"""Добавляет маршрут в конфиг cloudflared, не трогая остальные правила.

Использование: add_ingress.py <config.yml> <hostname> <service>
"""
import re
import shutil
import sys


def add_rule(text: str, hostname: str, service: str) -> str:
    if re.search(rf"hostname:\s*['\"]?{re.escape(hostname)}['\"]?\s*$", text, re.MULTILINE):
        return text
    lines = text.splitlines()
    start = next((i for i, line in enumerate(lines) if re.match(r"^ingress:\s*$", line)), None)
    if start is None:
        raise ValueError("в конфиге нет блока ingress")
    # Новое правило идёт первым: последним должно оставаться общее правило http_status:404.
    following = next((line for line in lines[start + 1:] if line.strip()), "")
    indent = following[: len(following) - len(following.lstrip())] if following.lstrip().startswith("-") else "  "
    rule = [f"{indent}- hostname: {hostname}", f"{indent}  service: {service}"]
    return "\n".join(lines[: start + 1] + rule + lines[start + 1 :]) + "\n"


def main() -> None:
    path, hostname, service = sys.argv[1:4]
    with open(path, encoding="utf-8") as f:
        old = f.read()
    new = add_rule(old, hostname, service)
    if new == old:
        print(f"Маршрут {hostname} уже есть в {path}")
        return
    shutil.copy2(path, f"{path}.bak")
    with open(path, "w", encoding="utf-8") as f:
        f.write(new)
    print(f"Маршрут {hostname} добавлен в {path}, копия: {path}.bak")


if __name__ == "__main__":
    main()
