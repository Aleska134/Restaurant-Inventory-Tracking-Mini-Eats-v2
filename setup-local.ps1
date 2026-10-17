# One-shot local setup. Run from the project root after Docker Desktop is running:
#   powershell -ExecutionPolicy Bypass -File .\setup-local.ps1
$ErrorActionPreference = 'Stop'

Write-Host "1/4 Starting Postgres (docker compose)..." -ForegroundColor Cyan
docker compose up -d
Write-Host "    waiting for DB to accept connections..."
Start-Sleep -Seconds 6

Push-Location backend
if (-not (Test-Path .env)) {
  Copy-Item .env.example .env
  Write-Host "    created backend/.env from example (DATABASE_URL points at local docker Postgres)" -ForegroundColor Yellow
}

Write-Host "2/4 Pushing Prisma schema..." -ForegroundColor Cyan
npx prisma db push

Write-Host "3/4 Seeding synthetic data (this loads 7k orders + 71k movements, ~1-2 min)..." -ForegroundColor Cyan
npm run seed

Pop-Location
Write-Host "4/4 Done. Now run the apps in two terminals:" -ForegroundColor Green
Write-Host "    cd backend;     npm run dev     # http://localhost:4000"
Write-Host "    cd manager-web; npm run dev     # http://localhost:5173"
