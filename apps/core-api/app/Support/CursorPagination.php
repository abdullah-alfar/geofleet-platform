<?php

namespace App\Support;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Support\Collection;

/**
 * Keyset ("cursor") pagination for the internal/v1 read endpoints admin-api
 * calls directly — replaces the identically-shaped scheme admin-api's own
 * cursor.ts used to implement against its (now removed) Kafka-projected
 * `admin_read` tables. Never OFFSET, for the same reason that code gave:
 * stable under concurrent writes, unlike an OFFSET that shifts as rows
 * change between pages.
 *
 * Every caller orders by `(orderColumn DESC, idColumn DESC)` — or ASC for
 * the `order=oldest` case the realtime incident feed needs (oldest-first,
 * hard-capped, not truly paginated) — and encodes the last row of a page
 * as the next cursor.
 */
class CursorPagination
{
    /**
     * @return array{data: Collection, next_cursor: ?string}
     */
    public static function paginate(
        Builder $query,
        string $idColumn,
        string $orderColumn,
        ?string $cursor,
        int $limit,
        string $direction = 'desc',
    ): array {
        $decoded = self::decode($cursor);

        if ($decoded !== null) {
            $op = $direction === 'desc' ? '<' : '>';
            $query->where(function (Builder $q) use ($orderColumn, $idColumn, $decoded, $op): void {
                $q->where($orderColumn, $op, $decoded['value'])
                    ->orWhere(function (Builder $q2) use ($orderColumn, $idColumn, $decoded, $op): void {
                        $q2->where($orderColumn, '=', $decoded['value'])
                            ->where($idColumn, $op, $decoded['id']);
                    });
            });
        }

        $rows = $query
            ->orderBy($orderColumn, $direction)
            ->orderBy($idColumn, $direction)
            ->limit($limit + 1)
            ->get();

        $hasMore = $rows->count() > $limit;
        $page = $rows->slice(0, $limit)->values();
        $last = $page->last();

        return [
            'data' => $page,
            'next_cursor' => ($hasMore && $last)
                ? self::encode($last->{$orderColumn}, $last->{$idColumn})
                : null,
        ];
    }

    private static function encode(mixed $orderValue, string $id): string
    {
        $value = $orderValue instanceof \DateTimeInterface
            ? $orderValue->format(\DateTimeInterface::ATOM)
            : (string) $orderValue;

        $json = json_encode(['value' => $value, 'id' => $id]);

        return rtrim(strtr(base64_encode($json), '+/', '-_'), '=');
    }

    /**
     * @return array{value: string, id: string}|null
     */
    private static function decode(?string $encoded): ?array
    {
        if ($encoded === null || $encoded === '') {
            return null;
        }

        $padded = str_pad(strtr($encoded, '-_', '+/'), (int) (4 * ceil(strlen($encoded) / 4)), '=', STR_PAD_RIGHT);
        $json = base64_decode($padded, true);
        if ($json === false) {
            return null;
        }

        $decoded = json_decode($json, true);
        if (! is_array($decoded) || ! isset($decoded['value'], $decoded['id']) || ! is_string($decoded['id'])) {
            return null;
        }

        return ['value' => $decoded['value'], 'id' => $decoded['id']];
    }
}
