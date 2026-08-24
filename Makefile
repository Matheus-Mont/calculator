# Convenience wrapper around the backend and frontend toolchains.
# Every target is a thin alias for the underlying go/npm command, so nothing
# here is required to build or run the project.

.PHONY: help install test test-backend test-frontend test-integration test-all \
        cover cover-backend cover-frontend lint dev-backend dev-frontend build \
        docker-up docker-down clean

GO ?= go

help: ## Show the available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-18s\033[0m %s\n", $$1, $$2}'

install: ## Install frontend dependencies
	cd frontend && npm ci

test: test-backend test-frontend ## Run the unit suites (fast)

test-all: test test-integration ## Run every suite, integration included

test-backend: ## Run the Go tests
	cd backend && $(GO) test ./...

test-frontend: ## Run the React tests
	cd frontend && npm run test

test-integration: ## Cross-boundary tests: real Go server behind the real proxy (needs Go)
	cd frontend && npm run test:integration

cover: cover-backend cover-frontend ## Produce coverage reports for both layers

cover-backend: ## Go coverage summary + HTML report at backend/coverage.html
	cd backend && $(GO) test ./... -coverprofile=coverage.out \
		&& $(GO) tool cover -func=coverage.out | tail -1 \
		&& $(GO) tool cover -html=coverage.out -o coverage.html

cover-frontend: ## Frontend coverage summary + HTML report at frontend/coverage/
	cd frontend && npm run test:coverage

lint: ## Formatting and static analysis
	cd backend && gofmt -l . && $(GO) vet ./...
	cd frontend && npm run typecheck

dev-backend: ## Run the API on :8080
	cd backend && $(GO) run ./cmd/server

dev-frontend: ## Run the Vite dev server on :5173
	cd frontend && npm run dev

build: ## Build both layers
	cd backend && $(GO) build -o server ./cmd/server
	cd frontend && npm run build

docker-up: ## Build and start the whole stack
	docker compose up --build

docker-down: ## Stop the stack and remove its volumes
	docker compose down -v

clean: ## Remove build and coverage artefacts
	rm -f backend/server backend/coverage.out backend/coverage.html
	rm -rf frontend/dist frontend/coverage
