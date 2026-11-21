# 把分镜台推到你自己的 GitHub 仓库
# 用法：右键这个文件 →「使用 PowerShell 运行」
# 我（AI）不需要你的账号密码，登录由 Git 自己弹浏览器完成

$ErrorActionPreference = 'Continue'
Set-Location $PSScriptRoot

Write-Host ""
Write-Host "  分镜台 · 推送到 GitHub" -ForegroundColor Cyan
Write-Host "  ─────────────────────────────" -ForegroundColor DarkGray
Write-Host "  先在 GitHub 网页上建一个空仓库（不要勾选 README / .gitignore），再回来。" -ForegroundColor Gray
Write-Host ""

$repo = Read-Host "1/3  粘贴仓库地址（形如 https://github.com/你的用户名/storyboard.git）"
if ([string]::IsNullOrWhiteSpace($repo)) {
    Write-Host "  没有填地址，退出。" -ForegroundColor Yellow
    Read-Host "按回车关闭"
    exit 1
}

$name = Read-Host "2/3  你的 GitHub 用户名（写成提交作者，直接回车就跳过）"
if (-not [string]::IsNullOrWhiteSpace($name)) {
    git config user.name $name
    git config user.email "$name@users.noreply.github.com"
    Write-Host "  正在把已有提交的作者改成 $name ..." -ForegroundColor DarkGray
    git rebase --root --exec "git commit --amend --no-edit --reset-author" 2>&1 | Out-Null
}

Write-Host ""
Write-Host "3/3  推送中（第一次会弹浏览器让你登录 GitHub）..." -ForegroundColor Cyan
git remote remove origin 2>$null
git remote add origin $repo
git branch -M main
git push -u origin main

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "  推完了。" -ForegroundColor Green
    Write-Host "  仓库地址：$repo" -ForegroundColor Gray
} else {
    Write-Host ""
    Write-Host "  推送失败。常见原因：" -ForegroundColor Yellow
    Write-Host "   · 仓库不存在，或地址写错（检查用户名和仓库名）" -ForegroundColor Gray
    Write-Host "   · 网络问题：GitHub 打不开的话，换 Gitee（gitee.com），步骤一样" -ForegroundColor Gray
    Write-Host "   · 还没登录：再跑一次，会重新弹登录窗口" -ForegroundColor Gray
}
Write-Host ""
Read-Host "按回车关闭"
