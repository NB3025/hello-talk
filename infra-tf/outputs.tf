output "site_url" {
  description = "공개 접속 URL"
  value       = "https://${aws_cloudfront_distribution.site.domain_name}/"
}

output "bucket_name" {
  description = "정적 자산 버킷 (퍼블릭 액세스 전면 차단)"
  value       = aws_s3_bucket.site.id
}

output "distribution_id" {
  description = "필요 시 무효화에 사용"
  value       = aws_cloudfront_distribution.site.id
}

output "uploaded_files" {
  description = "업로드된 파일 수"
  value       = length(aws_s3_object.site)
}
