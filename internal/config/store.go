// Package config persists Weiff's repository configuration.
package config

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

type Repository struct {
	Path string `json:"path"`
	Name string `json:"name,omitempty"`
}

type Config struct {
	CurrentRepository string       `json:"currentRepository"`
	Repositories      []Repository `json:"repositories"`
	LogRevset         string       `json:"logRevset"`
}

type Store struct {
	path string
	mu   sync.RWMutex
}

func DefaultDirectory() (string, error) {
	configDirectory, err := os.UserConfigDir()
	if err != nil {
		return "", fmt.Errorf("resolve user config directory: %w", err)
	}
	return filepath.Join(configDirectory, "weiff"), nil
}

func NewStore(directory string) (*Store, error) {
	directory = strings.TrimSpace(directory)
	if directory == "" {
		return nil, errors.New("config directory is required")
	}

	if err := os.MkdirAll(directory, 0o700); err != nil {
		return nil, fmt.Errorf("create config directory: %w", err)
	}
	if err := os.Chmod(directory, 0o700); err != nil {
		return nil, fmt.Errorf("secure config directory: %w", err)
	}

	return &Store{path: filepath.Join(directory, "config.json")}, nil
}

func (s *Store) Load() (Config, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()

	data, err := os.ReadFile(s.path)
	if errors.Is(err, os.ErrNotExist) {
		return Empty(), nil
	}
	if err != nil {
		return Config{}, fmt.Errorf("read config: %w", err)
	}

	decoder := json.NewDecoder(bytes.NewReader(data))
	decoder.DisallowUnknownFields()
	var stored Config
	if err := decoder.Decode(&stored); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	if err := ensureJSONEnd(decoder); err != nil {
		return Config{}, fmt.Errorf("decode config: %w", err)
	}
	return normalize(stored), nil
}

func (s *Store) CurrentRepository() (string, error) {
	value, err := s.Load()
	if err != nil {
		return "", err
	}
	return value.CurrentRepository, nil
}

func (s *Store) Save(value Config) (Config, error) {
	normalized := normalize(value)
	data, err := json.MarshalIndent(normalized, "", "  ")
	if err != nil {
		return Config{}, fmt.Errorf("encode config: %w", err)
	}
	data = append(data, '\n')

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := atomicWrite(filepath.Dir(s.path), s.path, data); err != nil {
		return Config{}, err
	}
	return normalized, nil
}

func Empty() Config {
	return Config{
		Repositories: []Repository{},
	}
}

func normalize(value Config) Config {
	normalized := Empty()
	normalized.CurrentRepository = strings.TrimSpace(value.CurrentRepository)
	normalized.LogRevset = strings.TrimSpace(value.LogRevset)

	repositories := make([]Repository, 0, len(value.Repositories)+1)
	indexes := make(map[string]int, len(value.Repositories)+1)
	add := func(repository Repository) {
		path := strings.TrimSpace(repository.Path)
		if path == "" {
			return
		}

		name := strings.TrimSpace(repository.Name)
		if index, exists := indexes[path]; exists {
			if repositories[index].Name == "" && name != "" {
				repositories[index].Name = name
			}
			return
		}

		indexes[path] = len(repositories)
		repositories = append(repositories, Repository{Path: path, Name: name})
	}

	add(Repository{Path: normalized.CurrentRepository})
	for _, repository := range value.Repositories {
		add(repository)
	}
	normalized.Repositories = repositories
	return normalized
}

func atomicWrite(directory, destination string, data []byte) (returnErr error) {
	temporary, err := os.CreateTemp(directory, ".weiff-*.tmp")
	if err != nil {
		return fmt.Errorf("create temporary config: %w", err)
	}
	temporaryName := temporary.Name()
	defer func() {
		_ = temporary.Close()
		_ = os.Remove(temporaryName)
	}()

	if err := temporary.Chmod(0o600); err != nil {
		return fmt.Errorf("secure temporary config: %w", err)
	}
	if _, err := temporary.Write(data); err != nil {
		return fmt.Errorf("write temporary config: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		return fmt.Errorf("sync temporary config: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary config: %w", err)
	}
	if err := os.Rename(temporaryName, destination); err != nil {
		return fmt.Errorf("replace config: %w", err)
	}
	if err := os.Chmod(destination, 0o600); err != nil {
		return fmt.Errorf("secure config: %w", err)
	}
	return syncDirectory(directory)
}

func syncDirectory(directory string) error {
	handle, err := os.Open(directory)
	if err != nil {
		return fmt.Errorf("open config directory: %w", err)
	}
	defer handle.Close()
	if err := handle.Sync(); err != nil {
		return fmt.Errorf("sync config directory: %w", err)
	}
	return nil
}

func ensureJSONEnd(decoder *json.Decoder) error {
	var extra any
	if err := decoder.Decode(&extra); !errors.Is(err, io.EOF) {
		if err == nil {
			return errors.New("config must contain exactly one JSON value")
		}
		return err
	}
	return nil
}
