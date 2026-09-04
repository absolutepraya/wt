function wt {
    [CmdletBinding()]
    param([Parameter(ValueFromRemainingArguments = $true)][string[]]$Arguments)

    $wtExecutable = (Get-Command wt -CommandType Application | Select-Object -First 1).Path
    if (-not $wtExecutable) {
        Write-Error "wt executable was not found."
        return
    }

    if ($Arguments.Count -gt 0 -and $Arguments[0] -in @('new', 'cd')) {
        $wtOutput = @(& $wtExecutable @Arguments)
        $wtStatus = $LASTEXITCODE
        $wtTarget = $null
        $wtConsumed = $false
        foreach ($wtLine in $wtOutput) {
            $wtText = [string]$wtLine
            if ($wtStatus -eq 0 -and -not $wtConsumed -and $wtText -match '^__cd__:(.+)$') {
                $wtCandidate = $Matches[1]
                if ([IO.Path]::IsPathRooted($wtCandidate)) {
                    $wtTarget = $wtCandidate
                    $wtConsumed = $true
                    continue
                }
            }
            Write-Output $wtText
        }
        if ($wtStatus -eq 0 -and $null -ne $wtTarget) {
            Set-Location -LiteralPath $wtTarget
        }
        $global:LASTEXITCODE = $wtStatus
        return
    }

    & $wtExecutable @Arguments
}
