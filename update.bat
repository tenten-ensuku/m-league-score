@echo off
chcp 65001 > nul
title Mリーグ成績表 自動更新
cd /d "%~dp0"

echo ====================================
echo   Mリーグ成績表 自動更新ツール
echo ====================================
echo.

:: Node.js チェック
node --version > nul 2>&1
if %errorlevel% neq 0 (
  echo [エラー] Node.js がインストールされていません。
  echo.
  echo 以下のサイトから Node.js をインストールしてください:
  echo   https://nodejs.org/ja/
  echo.
  pause
  exit /b 1
)

:: スクレイパー実行
node scrape.js

if %errorlevel% == 0 (
  echo.
  echo ブラウザで index.html を開きます...
  start "" "%~dp0index.html"
) else (
  echo.
  echo [エラー] 更新に失敗しました。
  echo 上のエラーメッセージを確認してください。
)

echo.
pause
