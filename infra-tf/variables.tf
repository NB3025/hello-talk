variable "region" {
  description = "리소스를 만들 리전. CloudFront 자체는 글로벌이지만 S3 버킷은 리전 리소스다."
  type        = string
  default     = "ap-northeast-2"
}

variable "name" {
  description = "리소스 이름 접두사"
  type        = string
  default     = "hello-talk"
}

variable "dist_dir" {
  description = "Vite 빌드 산출물 경로. 프로젝트 루트의 dist/"
  type        = string
  default     = "../dist"
}

variable "price_class" {
  description = "CloudFront 가격 등급. PriceClass_100 은 북미·유럽 엣지만 포함해 한국에서 원거리 엣지로 붙는다."
  type        = string
  default     = "PriceClass_200"
}
