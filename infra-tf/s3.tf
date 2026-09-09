data "aws_caller_identity" "current" {}

resource "random_id" "suffix" {
  byte_length = 4
}

/**
 * S3 정적 웹사이트 호스팅은 켜지 않는다. 그 엔드포인트는 퍼블릭 HTTP 라서
 * "퍼블릭 액세스 전면 차단 + CloudFront OAC 로만 읽기" 와 정면으로 어긋난다.
 */
resource "aws_s3_bucket" "site" {
  bucket = "${var.name}-site-${data.aws_caller_identity.current.account_id}-${random_id.suffix.hex}"

  # 스택을 지워도 버킷 안 객체가 남아 있으면 삭제가 실패한다.
  # 데모라 내용물을 지우고 버킷도 함께 정리되게 둔다.
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "site" {
  bucket = aws_s3_bucket.site.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_ownership_controls" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    object_ownership = "BucketOwnerEnforced"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "site" {
  bucket = aws_s3_bucket.site.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

resource "aws_s3_bucket_versioning" "site" {
  bucket = aws_s3_bucket.site.id
  versioning_configuration {
    status = "Disabled"
  }
}

/**
 * 버킷을 읽을 수 있는 것은 이 CloudFront 배포뿐이다.
 * Principal 은 서비스이고, SourceArn 조건으로 다른 배포는 배제된다.
 */
data "aws_iam_policy_document" "site" {
  statement {
    sid    = "AllowCloudFrontServicePrincipalReadOnly"
    effect = "Allow"

    principals {
      type        = "Service"
      identifiers = ["cloudfront.amazonaws.com"]
    }

    actions   = ["s3:GetObject"]
    resources = ["${aws_s3_bucket.site.arn}/*"]

    condition {
      test     = "StringEquals"
      variable = "AWS:SourceArn"
      values   = [aws_cloudfront_distribution.site.arn]
    }
  }

  statement {
    sid    = "DenyInsecureTransport"
    effect = "Deny"

    principals {
      type        = "*"
      identifiers = ["*"]
    }

    actions = ["s3:*"]
    resources = [
      aws_s3_bucket.site.arn,
      "${aws_s3_bucket.site.arn}/*",
    ]

    condition {
      test     = "Bool"
      variable = "aws:SecureTransport"
      values   = ["false"]
    }
  }
}

resource "aws_s3_bucket_policy" "site" {
  bucket = aws_s3_bucket.site.id
  policy = data.aws_iam_policy_document.site.json

  # 퍼블릭 차단 설정이 먼저 붙어야 정책 적용이 안전하다.
  depends_on = [aws_s3_bucket_public_access_block.site]
}
