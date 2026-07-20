@echo off
rem Atualiza o site no Vercel (mesma URL). Requer Node.js instalado.
cd /d "%~dp0"
call npx vercel --prod
pause
