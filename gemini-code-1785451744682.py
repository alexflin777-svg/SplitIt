#!/usr/bin/env python3
"""
Antigravity 2 Automation & Diagnostics Suite
Совместимо с Antigravity IDE v2 / Gemini 2 Agentic Workflow
"""

import os
import sys
import json
import subprocess
from pathlib import Path

# Цвета для вывода в консоль Antigravity
GREEN = "\033[92m"
YELLOW = "\033[93m"
RED = "\033[91m"
RESET = "\033[0m"

def log_status(msg, status="info"):
    prefix = f"{GREEN}[OK]{RESET}" if status == "ok" else f"{YELLOW}[WAIT]{RESET}" if status == "warn" else f"{RED}[ERR]{RESET}"
    print(f"{prefix} {msg}")

def check_mcp_config():
    """Проверка локальной конфигурации MCP для Antigravity 2"""
    log_status("Проверка конфигурации MCP-серверов...", "warn")
    
    # Стандартные пути к mcp_config.json в Antigravity
    config_paths = [
        Path.home() / ".gemini" / "config" / "mcp_config.json",
        Path.cwd() / ".agents" / "mcp_config.json"
    ]
    
    found = False
    for path in config_paths:
        if path.exists():
            try:
                with open(path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    servers = list(data.get("mcpServers", {}).keys())
                    log_status(f"Найден файл MCP: {path}", "ok")
                    log_status(f"Активные MCP-серверы ({len(servers)}): {', '.join(servers)}", "ok")
                    found = True
                    break
            except Exception as e:
                log_status(f"Ошибка чтения файла {path}: {e}", "err")
    
    if not found:
        log_status("mcp_config.json не найден. Создайте его в ~/.gemini/config/mcp_config.json", "err")

def init_agent_rules():
    """Создание структуры правил и суперсил (.agents/rules/)"""
    log_status("Инициализация правил для Antigravity 2 Agent...", "warn")
    rules_dir = Path.cwd() / ".agents" / "rules"
    rules_dir.mkdir(parents=True, exist_ok=True)
    
    rule_file = rules_dir / "antigravity2_core.md"
    if not rule_file.exists():
        rule_content = """# Antigravity 2 Agent Rules

## Core Principles
1. **Diverge-Converge Pattern:** Always propose 3 initial approaches before converging on a solution.
2. **Impeccable Design:** Follow high-quality UI/UX practices (smooth 300ms transitions, clean micro-interactions).
3. **Self-Verification:** Verify UI layout changes using Playwright/Browser MCP before marking tasks as finished.
4. **Code Quality:** Write modular TypeScript / Python with explicit types and clean memory usage.
"""
        with open(rule_file, "w", encoding="utf-8") as f:
            f.write(rule_content.strip())
        log_status(f"Создано базовое правило: {rule_file}", "ok")
    else:
        log_status(f"Правила агента уже существуют: {rule_file}", "ok")

def scan_project_structure():
    """Анализ структуры проекта для Codebase Memory"""
    log_status("Сканирование структуры проекта...", "warn")
    root_dir = Path.cwd()
    ignore_dirs = {".git", "node_modules", ".expo", "dist", "build", "__pycache__", ".venv"}
    
    file_count = 0
    dir_count = 0
    
    for root, dirs, files in os.walk(root_dir):
        dirs[:] = [d for d in dirs if d not in ignore_dirs]
        dir_count += len(dirs)
        file_count += len(files)
        
    log_status(f"Проект просканирован: {dir_count} папок, {file_count} файлов.", "ok")

def main():
    print(f"\n🚀 {GREEN}--- Antigravity 2 Automation Suite ---{RESET}\n")
    check_mcp_config()
    init_agent_rules()
    scan_project_structure()
    print(f"\n✨ {GREEN}Инициализация завершена. ИИ-агент Antigravity 2 готов к работе!{RESET}\n")

if __name__ == "__main__":
    main()