package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"weiff/internal/config"
	"weiff/internal/httpapi"
	"weiff/internal/httpserver"
	"weiff/internal/repo"
	"weiff/internal/restoretool"
	"weiff/internal/webui"
)

func main() {
	if err := run(os.Args[1:]); err != nil {
		slog.Error("weiff stopped", "error", err)
		os.Exit(1)
	}
}

func run(args []string) error {
	if handled, err := restoretool.Run(args); handled {
		return err
	}

	defaultConfigDirectory, err := config.DefaultDirectory()
	if err != nil {
		return fmt.Errorf("resolve config directory: %w", err)
	}

	flags := flag.NewFlagSet("weiff", flag.ContinueOnError)
	addr := flags.String("addr", envOrDefault("WEIFF_ADDR", "127.0.0.1:7000"), "HTTP address to listen on")
	publicURL := flags.String("public-url", os.Getenv("WEIFF_PUBLIC_URL"), "trusted public HTTP origin when using a reverse proxy")
	allowRemote := flags.Bool("allow-remote", false, "allow listening on a non-loopback address")
	configDirectory := flags.String("config-dir", envOrDefault("WEIFF_CONFIG_DIR", defaultConfigDirectory), "configuration directory")
	if err := flags.Parse(args); err != nil {
		return err
	}
	if flags.NArg() != 0 {
		return fmt.Errorf("unexpected positional arguments: %q", flags.Args())
	}
	if err := httpserver.ValidateListenAddress(*addr, *allowRemote); err != nil {
		return err
	}
	publicOrigin, err := httpserver.ResolvePublicOrigin(*addr, *publicURL)
	if err != nil {
		return err
	}

	configStore, err := config.NewStore(*configDirectory)
	if err != nil {
		return fmt.Errorf("initialize config store %q: %w", *configDirectory, err)
	}

	client := repo.NewJJClientWithRepoPathResolver(configStore.CurrentRepository)
	apiServer := httpapi.NewServer(client, configStore)
	root := http.NewServeMux()
	root.Handle("/api/", apiServer.Handler())
	if frontend, ok := webui.Handler(); ok {
		root.Handle("/", frontend)
	} else {
		root.HandleFunc("/", frontendNotEmbedded)
	}
	handler, err := httpserver.Middleware(root, publicOrigin)
	if err != nil {
		return err
	}
	server := &http.Server{
		Addr:              *addr,
		Handler:           handler,
		ReadHeaderTimeout: 5 * time.Second,
		IdleTimeout:       60 * time.Second,
	}

	shutdownContext, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	serverErrors := make(chan error, 1)
	slog.Info("weiff listening", "addr", *addr, "public_url", publicOrigin, "config_dir", *configDirectory)
	go func() {
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if errors.Is(err, http.ErrServerClosed) {
			return nil
		}
		return err
	case <-shutdownContext.Done():
	}

	slog.Info("weiff shutting down")
	graceContext, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	if err := server.Shutdown(graceContext); err != nil {
		return fmt.Errorf("graceful shutdown: %w", err)
	}
	return nil
}

func frontendNotEmbedded(w http.ResponseWriter, _ *http.Request) {
	http.Error(w, "frontend is not embedded; run the Angular development server or build with -tags embed_frontend", http.StatusNotFound)
}

func envOrDefault(name, fallback string) string {
	if value := os.Getenv(name); value != "" {
		return value
	}
	return fallback
}
