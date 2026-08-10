# syntax=docker/dockerfile:1
FROM golang:1.26.3-alpine AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/realtime-gateway ./cmd/realtime-gateway

# Same static-distroless pattern as apps/location-service and
# apps/dispatch-service — this service has no cgo dependencies either.
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/realtime-gateway /realtime-gateway

USER nonroot:nonroot
EXPOSE 8083

ENTRYPOINT ["/realtime-gateway"]
