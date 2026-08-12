export interface PaginatedResponse<T> {
  data: T[];
  meta: {
    next_cursor: string | null;
  };
}
