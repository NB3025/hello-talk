/**
 * dist/ 의 모든 파일을 버킷에 올린다.
 *
 * CDK 의 BucketDeployment 는 이 일을 하려고 Lambda 하나와 레이어 둘, IAM 역할과
 * 정책을 함께 만든다. Terraform 은 aws_s3_object 로 직접 올리므로 그 부수 리소스가
 * 전부 없다 — 이 배포에서 Terraform 이 실제로 더 단순한 지점이다.
 */

locals {
  dist_files = fileset(var.dist_dir, "**/*")

  # 확장자 → Content-Type. 빠지면 브라우저가 파일을 다운로드로 처리해버린다.
  mime = {
    html        = "text/html; charset=utf-8"
    js          = "text/javascript; charset=utf-8"
    mjs         = "text/javascript; charset=utf-8"
    css         = "text/css; charset=utf-8"
    json        = "application/json; charset=utf-8"
    svg         = "image/svg+xml"
    png         = "image/png"
    jpg         = "image/jpeg"
    jpeg        = "image/jpeg"
    gif         = "image/gif"
    webp        = "image/webp"
    ico         = "image/x-icon"
    woff        = "font/woff"
    woff2       = "font/woff2"
    ttf         = "font/ttf"
    map         = "application/json; charset=utf-8"
    txt         = "text/plain; charset=utf-8"
    webmanifest = "application/manifest+json"
  }
}

resource "aws_s3_object" "site" {
  for_each = local.dist_files

  bucket = aws_s3_bucket.site.id
  key    = each.value
  source = "${var.dist_dir}/${each.value}"

  # 내용이 바뀌면 etag 가 바뀌어 Terraform 이 재업로드한다.
  etag = filemd5("${var.dist_dir}/${each.value}")

  content_type = lookup(
    local.mime,
    lower(element(reverse(split(".", each.value)), 0)),
    "application/octet-stream"
  )

  /**
   * 캐시 정책을 파일 종류로 나눈다.
   * - /assets/* 는 파일명에 콘텐츠 해시가 있어 내용이 바뀌면 URL 이 바뀐다 → 1년 immutable
   * - index.html 은 항상 같은 URL 이므로 캐시하면 새 배포가 보이지 않는다 → no-cache
   *
   * index.html 이 no-cache 라서 재배포 때 CloudFront 무효화가 필요하지 않다.
   * (전체 /* 무효화는 불필요하고 무효화 요청 수 과금 대상이 된다.)
   */
  cache_control = startswith(each.value, "assets/") ? "public, max-age=31536000, immutable" : "no-cache"

  depends_on = [aws_s3_bucket_ownership_controls.site]
}
