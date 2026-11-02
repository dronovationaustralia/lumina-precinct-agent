# Makes data/derived/demo/voice.wav for the demo recorder's voice scene with the built-in Windows
# speech synthesiser (no microphone or recording needed). Mono, 24 kHz, 16-bit PCM: the format
# Muse Voice Transcribe documents.
#
#   powershell -ExecutionPolicy Bypass -File scripts/demo/make-voice.ps1
#   powershell -ExecutionPolicy Bypass -File scripts/demo/make-voice.ps1 -Text "Your question"
param(
  [string]$Text = "How busy is this station, and is patronage growing?",
  [string]$Out = "data/derived/demo/voice.wav"
)
Add-Type -AssemblyName System.Speech
$dir = Split-Path -Parent $Out
if ($dir -and -not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
$path = Join-Path (Get-Location) $Out
$synth = New-Object System.Speech.Synthesis.SpeechSynthesizer
# Prefer an English (Australia), then any English, voice that is installed.
$voices = $synth.GetInstalledVoices() | Where-Object { $_.Enabled } | ForEach-Object { $_.VoiceInfo }
$pick = ($voices | Where-Object { $_.Culture.Name -eq 'en-AU' } | Select-Object -First 1)
if (-not $pick) { $pick = ($voices | Where-Object { $_.Culture.Name -like 'en-*' } | Select-Object -First 1) }
if ($pick) { $synth.SelectVoice($pick.Name) }
$synth.Rate = -1
$format = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(24000, [System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen, [System.Speech.AudioFormat.AudioChannel]::Mono)
$synth.SetOutputToWaveFile($path, $format)
# A short silence before and after, so the microphone catches the whole question.
$prompt = New-Object System.Speech.Synthesis.PromptBuilder
$prompt.AppendBreak([TimeSpan]::FromMilliseconds(400))
$prompt.AppendText($Text)
$prompt.AppendBreak([TimeSpan]::FromMilliseconds(500))
$synth.Speak($prompt)
$synth.Dispose()
Write-Output "Wrote $Out with voice '$($pick.Name)': `"$Text`""
