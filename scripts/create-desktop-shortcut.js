const path = require('node:path');
const { execFileSync } = require('node:child_process');
if (process.platform !== 'win32') {
  console.error('Run Setup Windows.cmd on the Windows computer.');
  process.exitCode = 1;
} else {
  try {
    // Pass filesystem paths through environment values rather than PowerShell code.
    execFileSync('powershell.exe', ['-NoProfile', '-Command', `
      $ErrorActionPreference = 'Stop'
      $shell = New-Object -ComObject WScript.Shell
      $desktop = [Environment]::GetFolderPath('Desktop')
      $link = $shell.CreateShortcut((Join-Path $desktop 'Shelf Sorter.lnk'))
      $link.TargetPath = Join-Path $env:SHELF_SORTER_FOLDER 'Start Shelf Sorter.cmd'
      $link.WorkingDirectory = $env:SHELF_SORTER_FOLDER
      $link.IconLocation = $env:SHELF_SORTER_NODE + ',0'
      $link.Description = 'KTRU Shelf Sorter'
      $link.WindowStyle = 1
      $link.Save()
    `], { stdio: 'inherit', env: { ...process.env,
      SHELF_SORTER_FOLDER: path.resolve(__dirname, '..'), SHELF_SORTER_NODE: process.execPath
    }});
    console.log('Created Shelf Sorter on your desktop.');
  } catch (error) {
    console.error('Could not create the shortcut. You can still double-click Start Shelf Sorter.cmd.');
    process.exitCode = 1;
  }
}
