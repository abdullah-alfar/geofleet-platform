# syntax=docker/dockerfile:1
FROM golang:1.26.3-alpine AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/location-service ./cmd/location-service

# Distroless static: no shell, no package manager — pure Go binary with no
# cgo dependencies (pgx, go-redis, and franz-go are all pure Go), so this is
# the minimal viable runtime image for this service.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/location-service /location-service

USER nonroot:nonroot
EXPOSE 8081

ENTRYPOINT ["/location-service"]
