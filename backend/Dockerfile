# ---- build ----
FROM golang:1.27-alpine AS build

WORKDIR /src

# The module has no external dependencies, so there is nothing to download;
# copying go.mod first still lets Docker cache this layer.
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

# Tests run in the image build: a broken build can never be published.
RUN go vet ./... && go test ./...

# CGO_ENABLED=0 produces a static binary, which is what lets the final stage be
# `scratch`. -trimpath and -ldflags strip build paths and debug info.
RUN CGO_ENABLED=0 GOOS=linux go build \
      -trimpath \
      -ldflags="-s -w" \
      -o /out/server ./cmd/server

# ---- runtime ----
# scratch: no shell, no package manager, nothing for an attacker to use.
FROM scratch

COPY --from=build /out/server /server

# A non-root UID. There is no /etc/passwd in scratch, so the numeric form is
# required.
USER 65534:65534

ENV PORT=8080
EXPOSE 8080

ENTRYPOINT ["/server"]
