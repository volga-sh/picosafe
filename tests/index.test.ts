import { describe, it, expect } from 'vitest'
import { add, subtract, multiply, divide } from '../src/index'

describe('Math functions', () => {
	describe('add', () => {
		it('should add two positive numbers', () => {
			expect(add(2, 3)).toBe(5)
		})

		it('should add negative numbers', () => {
			expect(add(-1, -1)).toBe(-2)
		})
	})

	describe('subtract', () => {
		it('should subtract two numbers', () => {
			expect(subtract(5, 3)).toBe(2)
		})

		it('should handle negative results', () => {
			expect(subtract(2, 5)).toBe(-3)
		})
	})

	describe('multiply', () => {
		it('should multiply two numbers', () => {
			expect(multiply(3, 4)).toBe(12)
		})

		it('should handle zero', () => {
			expect(multiply(5, 0)).toBe(0)
		})
	})

	describe('divide', () => {
		it('should divide two numbers', () => {
			expect(divide(10, 2)).toBe(5)
		})

		it('should throw error for division by zero', () => {
			expect(() => divide(10, 0)).toThrow('Division by zero')
		})
	})
})