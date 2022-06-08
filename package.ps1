$YourDirToCompress=".\"
$ZipFileResult=".\bookmark_flow.zip"
$ToExclude=@(".git", "publish", ".gitignore", "package.ps1")
Get-ChildItem -Path $YourDirToCompress -Exclude $ToExclude | Compress-Archive -DestinationPath $ZipFileResult -Update
