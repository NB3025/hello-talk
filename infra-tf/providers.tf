terraform {
  required_version = ">= 1.9"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.7"
    }
  }

  # 상태는 이 디렉터리의 terraform.tfstate 에 로컬로 둔다.
  # 원격 백엔드(S3 + DynamoDB 잠금)는 그 자체로 버킷이 먼저 있어야 하는
  # 닭·달걀 문제라, 1인 데모 규모에서는 로컬 상태가 맞다.
  # 상태 파일을 잃으면 리소스를 Terraform 이 더 이상 추적하지 못하므로 지우지 말 것.
}

provider "aws" {
  region = var.region

  default_tags {
    tags = {
      Project   = "hello-talk"
      ManagedBy = "terraform"
    }
  }
}
