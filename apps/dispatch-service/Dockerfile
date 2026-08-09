# syntax=docker/dockerfile:1
FROM golang:1.26.3-alpine AS builder
WORKDIR /src

COPY go.mod go.sum ./
RUN go mod download

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/dispatch-service ./cmd/dispatch-service

# Same static-distroless pattern as apps/location-service — possible here
# specifically because geo-cell indexing uses pure-Go geohash instead of
# cgo-based H3 bindings (see docs/decisions/0005-geohash-and-dispatch-db-access.md).
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=builder /out/dispatch-service /dispatch-service

USER nonroot:nonroot
EXPOSE 8082

ENTRYPOINT ["/dispatch-service"]
