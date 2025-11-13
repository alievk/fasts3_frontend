COMPOSE = docker compose -f docker-compose.yml

SRC_DIR = src
BUILD_STAMP = .make/npm-build.stamp
SRC_FILES = $(shell find $(SRC_DIR) -type f)

.PHONY: up down logs build restart

up: build
	$(COMPOSE) up -d $(S)

down:
	$(COMPOSE) down $(S)

logs:
	$(COMPOSE) logs -f $(S)

build: $(BUILD_STAMP)
	$(COMPOSE) build

restart: build
	$(COMPOSE) restart $(S)

$(BUILD_STAMP): $(SRC_FILES)
	@mkdir -p $(dir $@)
	npm run build
	@touch $@
