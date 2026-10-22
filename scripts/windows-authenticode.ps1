param([Parameter(Mandatory = $true, Position = 0)][string]$ArtifactPath)
$ErrorActionPreference = 'Stop'
$signature = Get-AuthenticodeSignature -LiteralPath $ArtifactPath
$publisher = $null
if ($null -ne $signature.SignerCertificate) {
    $publisher = $signature.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
}
@{
    status = [string]$signature.Status
    subject = $signature.SignerCertificate.Subject
    publisherName = $publisher
    signerThumbprint = $signature.SignerCertificate.Thumbprint
    timestampSubject = $signature.TimeStamperCertificate.Subject
    timestampThumbprint = $signature.TimeStamperCertificate.Thumbprint
} | ConvertTo-Json -Compress
