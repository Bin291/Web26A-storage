FE_DIR := storage
BE_DIR := storage-api

.PHONY: help install install-fe install-be \
	fe be dev \
	build build-fe build-be \
	test test-fe test-be \
	lint lint-fe lint-be \
	clean

help:
	@echo "Targets:"
	@echo "  make install     - cai dependencies cho ca FE va BE"
	@echo "  make fe          - chay FE dev server (storage, port 4200)"
	@echo "  make be          - chay BE dev server (storage-api, port 3000, watch mode)"
	@echo "  make dev         - chay song song ca FE va BE"
	@echo "  make build       - build production ca FE va BE"
	@echo "  make test        - chay test ca FE va BE"
	@echo "  make lint        - lint ca FE va BE"
	@echo "  make clean       - xoa node_modules va build output ca 2 project"

install: install-fe install-be

install-fe:
	cd $(FE_DIR) && npm install

install-be:
	cd $(BE_DIR) && npm install

fe: install-fe
	cd $(FE_DIR) && npm start

be: install-be
	cd $(BE_DIR) && npm run start:dev

dev:
	$(MAKE) -j2 fe be

build: build-fe build-be

build-fe:
	cd $(FE_DIR) && npm run build

build-be:
	cd $(BE_DIR) && npm run build

test: test-fe test-be

test-fe:
	cd $(FE_DIR) && npm test

test-be:
	cd $(BE_DIR) && npm test

lint: lint-fe lint-be

lint-fe:
	cd $(FE_DIR) && npm run lint --if-present

lint-be:
	cd $(BE_DIR) && npm run lint

clean:
	rm -rf $(FE_DIR)/dist $(FE_DIR)/node_modules $(FE_DIR)/.angular
	rm -rf $(BE_DIR)/dist $(BE_DIR)/node_modules
