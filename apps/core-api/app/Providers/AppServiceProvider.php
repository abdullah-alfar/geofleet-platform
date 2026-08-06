<?php

namespace App\Providers;

use App\Contracts\KafkaProducer;
use App\Infrastructure\Kafka\RdKafkaProducer;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    /**
     * Register any application services.
     */
    public function register(): void
    {
        $this->app->singleton(KafkaProducer::class, fn () => new RdKafkaProducer(
            config('kafka.brokers'),
        ));
    }

    /**
     * Bootstrap any application services.
     */
    public function boot(): void
    {
        // General API traffic: per authenticated user where possible,
        // falling back to IP for unauthenticated requests.
        RateLimiter::for('api', function (Request $request) {
            return Limit::perMinute(60)->by($request->user()?->id ?: $request->ip());
        });

        // Tighter limit on register/login specifically — brute-force and
        // account-enumeration protection (brief: "Rate limiting" under
        // Security Requirements). Keyed by IP since there's no
        // authenticated user yet at this point.
        RateLimiter::for('auth', function (Request $request) {
            return Limit::perMinute(10)->by($request->ip());
        });
    }
}
